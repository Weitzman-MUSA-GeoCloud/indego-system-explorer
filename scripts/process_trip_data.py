import csv
import datetime
import io
import json
import pathlib
import re
import requests
import sys
import zipfile
import typing
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
from google.cloud import storage

from get_trip_data_urls import get_trip_data_urls

DATA_DIR = pathlib.Path(__file__).parent.parent / "data"
ISO8601_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}(T| )\d{2}:\d{2}:\d{2}(\.\d+)?Z?$")


def mdyhm_to_iso(date_str: str) -> str:
    """
    Convert a date string from 'M/D/YYYY H:MM' format to ISO 8601 format.
    """
    if not date_str:
        return date_str

    # Sometimes it's already ISO 8601 🙄
    if ISO8601_PATTERN.match(date_str):
        return date_str
    try:
        return datetime.datetime.strptime(date_str, "%m/%d/%Y %H:%M").isoformat()
    except ValueError:
        # Sometimes the year is only two digits 🙄
        try:
            return datetime.datetime.strptime(date_str, "%m/%d/%y %H:%M").isoformat()
        except ValueError:
            raise ValueError(f"Invalid date format: {date_str}. Expected format: 'M/D/YYYY H:MM' or 'M/D/YY H:MM'.")


def str_to_int(value: str) -> int | None:
    """
    Convert a string to an integer, returning None if the string is empty or not a number.
    """
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        raise ValueError(f"Invalid integer value: {value}. Expected an integer.")


def latlng_to_point(lat: str, lng: str) -> str | None:
    """
    Convert latitude and longitude strings to a WKT POINT representation.
    """
    if not lat or not lng:
        return None

    # Check if lat/lng are valid numbers
    try:
        float(lat)
        float(lng)
    except ValueError:
        return None

    try:
        return f"POINT({lng} {lat})"
    except ValueError:
        raise ValueError(f"Invalid lat/lng values: {lat}, {lng}. Expected valid coordinates.")


def fetch_trip_data(url: str, outstream: typing.BinaryIO) -> None:
    """
    Fetch trip data from a URL and write it to an output stream.
    """
    import requests
    response = requests.get(
        url,
        allow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0"}
    )
    if response.status_code != 200:
        raise ValueError(f"Failed to fetch data from {url}: {response.status_code}")
    outstream.write(response.content)


def make_raw_file_name(label: str) -> str:
    """
    Generate a file name for the trip data based on the label.
    """
    label_pattern = re.compile(r"^(\d{4}) Q(\d) .*$")
    year, quarter = label_pattern.match(label).groups()
    assert year and quarter, f"Invalid label format: {label}. Expected format: 'YYYY QX'."
    return f'indego-trips-{year}-{quarter}.zip'


def save_raw_data_local(label: str, url: str) -> None:
    """
    Save trip data from a URL to a file.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    destination_path = DATA_DIR / make_raw_file_name(label)

    if destination_path.exists():
        print(f"Trip data for {label} already exists at {destination_path}")
        return

    print(f"Downloading trip data for {label} from {url}...")

    with destination_path.open('wb') as outfile:
        try:
            fetch_trip_data(url, outfile)
        except Exception as e:
            # Delete the file if the download fails
            if destination_path.exists():
                destination_path.unlink()
            raise e

    print(f"Saved trip data to {destination_path}")


def save_raw_data_gcs(label: str, url: str) -> None:
    """
    Save trip data from a URL to a Google Cloud Storage bucket.
    """
    client = storage.Client()
    bucket = client.bucket("indego-bikeshare-data")
    blob = bucket.blob(f"trips/{make_raw_file_name(label)}")

    if blob.exists():
        print(f"Trip data for {label} already exists in GCS: {blob.public_url}")
        return

    # Download the file from the URL
    response = requests.get(url)
    if response.status_code != 200:
        raise ValueError(f"Failed to fetch data from {url}: {response.status_code}")

    # Upload the file to GCS
    blob.upload_from_string(response.content, content_type="application/zip")
    print(f"Saved trip data to GCS: {blob.public_url}")


def fetch_all_raw_data(location: str) -> None:
    """
    Download trip data from the Indego bikeshare data portal and save it
    locally if it's not already downloaded.
    """
    trip_data_urls = get_trip_data_urls()

    if location == "local":
        save_raw_data = save_raw_data_local
    elif location == "gcs":
        save_raw_data = save_raw_data_gcs
    else:
        raise ValueError("Invalid location specified. Use 'local' or 'gcs'.")

    # with ThreadPoolExecutor(max_workers=1) as executor:
    #     for label, url in trip_data_urls:
    #         executor.submit(save_raw_data, label, url)
    for label, url in trip_data_urls:
        save_raw_data(label, url)


def process_trip_data(
        zipstream: typing.BinaryIO,
        jsonlstream: typing.TextIO) -> None:
    """
    Process the trip data CSV file and convert it to JSON format.
    """
    # Read the CSV file from the zip archive
    with zipfile.ZipFile(zipstream) as z:
        # Sometimes there are two files in the zip archive, one with data
        # about the stations (it has "stations" in the file name) and one
        # with data about the trips (it has "trips" in the file name).
        # We want the one with "trips" in the file name.
        #
        # Sometimes the trips file has "echo" in the file name instead of
        # "trips" 🙄.

        trips_filename = next(
            (name for name in z.namelist()
             if "trips" in name.lower() or "echo" in name.lower()),
            None
        )

        if not trips_filename:
            raise ValueError("No trips file found in the zip archive.")

        with z.open(trips_filename) as bytefile:
            # Wrap the byte file in a text stream
            csvfile = io.TextIOWrapper(bytefile, encoding='utf-8')

            # Create a CSV reader
            reader = csv.DictReader(csvfile)

            # Read the CSV file
            reader = csv.DictReader(csvfile)
            data = [{
                **row,
                # Convert "duration" to an integer
                "duration": str_to_int(row["duration"]),
                # Convert "start_time" and "end_time" to ISO format
                "start_time": mdyhm_to_iso(row["start_time"]),
                "end_time": mdyhm_to_iso(row["end_time"]),
                # Create a "start_pt" and "end_pt" from lat/lng coordinates
                "start_pt": latlng_to_point(row["start_lat"], row["start_lon"]),
                "end_pt": latlng_to_point(row["end_lat"], row["end_lon"]),
            } for row in reader]

            # Write the data to a JSON-L file
            for row in data:
                json.dump(row, jsonlstream)
                jsonlstream.write('\n')


def save_processed_data_local(raw_file_name: str) -> None:
    """
    Process the trip data CSV file and save it to a JSONL file.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    raw_file_path = DATA_DIR / raw_file_name
    fn_pattern = re.compile(r"^indego-trips-(\d{4})-(\d).zip$")
    year, quarter = fn_pattern.match(raw_file_name).groups()
    assert year and quarter, f"Invalid file name format: {raw_file_name}. Expected format: 'indego-trips-YYYY-Q.zip'."
    jsonl_file_path = DATA_DIR / f'year={year}/quarter={quarter}/data.jsonl'
    jsonl_file_path.parent.mkdir(parents=True, exist_ok=True)

    if jsonl_file_path.exists():
        print(f"Processed data already exists at {jsonl_file_path}")
        return

    print(f"Processing trip data from {raw_file_path}...")

    with raw_file_path.open('rb') as zipstream:
        with jsonl_file_path.open('w') as jsonlstream:
            try:
                process_trip_data(zipstream, jsonlstream)
            except Exception as e:
                # Delete the jsonl file if processing fails
                if jsonl_file_path.exists():
                    jsonl_file_path.unlink()
                raise e

    print(f"Processed trip data saved to {jsonl_file_path}")


def save_processed_data_gcs(raw_file_name: str) -> None:
    """
    Process the trip data CSV file and save it to a JSONL file in GCS.
    """
    client = storage.Client()
    raw_bucket = client.bucket("indego-bikeshare-data")
    processed_bucket = client.bucket("indego-bikeshare-data-processed")

    raw_blob = raw_bucket.blob(f"trips/{raw_file_name}")
    year, quarter = raw_file_name.split('-')[2:4]
    jsonl_blob = processed_bucket.blob(f"trips/year={year}/quarter={quarter}/data.jsonl")

    if jsonl_blob.exists():
        print(f"Processed data already exists in GCS: {jsonl_blob.public_url}")
        return

    with raw_blob.open('rb') as zipstream:
        with jsonl_blob.open('w') as jsonlstream:
            try:
                process_trip_data(zipstream, jsonlstream)
            except Exception as e:
                # Delete the jsonl blob if processing fails
                if jsonl_blob.exists():
                    jsonl_blob.delete()
                raise e

    print(f"Processed trip data saved to GCS: {jsonl_blob.public_url}")


def process_all_trip_data(location: str) -> None:
    """
    Process all trip data files and convert them to JSON format.
    """
    if location == "local":
        save_processed_data = save_processed_data_local
        raw_file_names = [f.name for f in DATA_DIR.glob("*.zip")]
    elif location == "gcs":
        save_processed_data = save_processed_data_gcs
        client = storage.Client()
        raw_bucket = client.bucket("indego-bikeshare-data")
        raw_blobs = raw_bucket.list_blobs(prefix="trips/")
        raw_file_names = [blob.name.split('/')[-1] for blob in raw_blobs if blob.name.endswith(".zip")]
    else:
        raise ValueError("Invalid location specified. Use 'local' or 'gcs'.")

    for raw_file_name in raw_file_names:
        save_processed_data(raw_file_name)
    # with ProcessPoolExecutor(max_workers=8) as executor:
    #     for raw_file_name in raw_file_names:
    #         executor.submit(save_processed_data, raw_file_name)


if __name__ == "__main__":
    # Use stdin as the input CSV file and stdout as the output JSONL file
    # process_trip_data(
    #     zipstream=sys.stdin,
    #     jsonlstream=sys.stdout
    # )
    fetch_all_raw_data("local")
    process_all_trip_data("local")
