-- Create or replace the source.indego_trips external table
-- to load the Indego bike share trip data from GCS at
-- gs://indego-bikeshare-tools-prepared_data/indego_trips/year=2024/*.jsonl
-- Use the year as a partition key.

CREATE OR REPLACE EXTERNAL TABLE source.indego_trips (
    trip_id STRING,
    duration INT,
    start_time DATETIME,
    end_time DATETIME,
    start_station STRING,
    start_pt GEOGRAPHY,
    end_station STRING,
    end_pt GEOGRAPHY,
    bike_id STRING,
    plan_duration STRING,
    trip_route_category STRING,
    passholder_type STRING,
    bike_type STRING,
)
WITH PARTITION COLUMNS (
    year INT,
    quarter INT,
)
OPTIONS (
    format = 'JSON',
    uris = ['gs://indego-bikeshare-tools-prepared_data/indego_trips/*.jsonl'],
    hive_partition_uri_prefix = 'gs://indego-bikeshare-tools-prepared_data/indego_trips/',
    ignore_unknown_values = TRUE
)
