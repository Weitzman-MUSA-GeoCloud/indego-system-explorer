# Indego System Explorer

A simple dashboard displaying historical usage of the Indego bikeshare system.

The API relies on a BigQuery table named `indego_trips` containing historical trip data with at least the following columns:

* `start_date DATE`
* `end_date DATE`
* `start_station STRING`
* `end_station STRING`
* `start_pt GEOGRAPHY`
* `end_pt GEOGRAPHY`

## Uploading data

Data processing is done locally for now. To upload processed data to GCS run:

```bash
python data/process_trip_data.py
gcloud storage cp --recursive --no-clobber data/year* gs://indego-bikeshare-tools-prepared_data/indego_trips
```

## Deploying the API

```bash
gcloud run deploy get-popularity \
    --project indego-bikeshare-tools \
    --source api/get_popularity \
    --function get_popularity \
    --base-image python312 \
    --region us-east4 \
    --min-instances 0 \
    --max-instances 10 \
    --allow-unauthenticated
```
