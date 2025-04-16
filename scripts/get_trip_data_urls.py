"""
Scrape trip data URLs from the Indego bikeshare data portal at
https://www.rideindego.com/about/data/

Usage:
    python get_trip_data_urls.py
"""
import requests
from bs4 import BeautifulSoup
import sys


DataFileName = str
DataFileUrl = str


def get_trip_data_urls() -> list[tuple[DataFileName, DataFileUrl]]:
    """
    Scrape trip data URLs from the Indego bikeshare data portal.
    """
    url = "https://www.rideindego.com/about/data/"
    response = requests.get(
        url,
        allow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0"}
    )
    assert response.status_code == 200, \
        f"Failed to fetch data from {url}: {response.status_code}"

    # Parse the HTML content using BeautifulSoup
    soup = BeautifulSoup(response.text, "html.parser")

    # Find an `h1` on the page with the text "Trip Data"
    h1 = soup.find("h1", string="Trip Data")
    assert h1, "Failed to find 'Trip Data' section on the page."

    # Find the first `ul` element after the h1
    ul = h1.find_next("ul")
    assert ul, "Failed to find list of trip data files."

    # Find all `a` elements within the `ul` and extract the href attributes
    # and text content
    links = ul.find_all("a", href=True)
    trip_data_links = [
        (link.text.strip(), link["href"])
        for link in links if ".zip" in link["href"]
    ]

    return trip_data_links


if __name__ == "__main__":
    trip_data_urls = get_trip_data_urls()
    print(f"Found {len(trip_data_urls)} trip data URLs:", file=sys.stderr)
    for name, url in trip_data_urls:
        print(f"{name}: {url}")
