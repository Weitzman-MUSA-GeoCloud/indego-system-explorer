# Indego System Explorer

A simple dashboard displaying historical usage of the Indego bikeshare system.

Data processing is done locally for now. To upload processed data to GCS run:

```bash
gcloud storage cp --recursive data/year* gs://indego-bikeshare-tools-prepared_data/indego_trips
```