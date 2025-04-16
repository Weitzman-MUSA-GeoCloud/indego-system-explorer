import flask
import functions_framework
from google.cloud import bigquery


@functions_framework.http
def get_popularity(request: flask.Request) -> flask.typing.ResponseReturnValue:
    start_hour = request.args.get('start_hour') or 0
    end_hour = request.args.get('end_hour') or 23

    # Validate the input
    try:
        start_hour = int(start_hour)
        end_hour = int(end_hour)
        if start_hour < 0 or start_hour > 22:
            raise ValueError("start_hour must be between 0 and 22")
        if end_hour < 1 or end_hour > 23:
            raise ValueError("end_hour must be between 1 and 23")
        if start_hour >= end_hour:
            raise ValueError("start_hour must be less than end_hour")
    except ValueError as e:
        return flask.jsonify({'error': str(e)}), 400

    sql = f'''
    WITH daily_origin_trip_count AS (
        SELECT
            start_station as station_id,
            start_date as trip_date,
            any_value(start_pt) as station_pt,
            count(*) AS trip_count
        FROM `indego-bikeshare-tools.core.indego_trips`
        WHERE EXTRACT(HOUR FROM start_time) BETWEEN {start_hour} AND {end_hour}
        GROUP BY start_station, start_date
    ),

    daily_destination_trip_count AS (
        SELECT
            end_station as station_id,
            end_date as trip_date,
            any_value(end_pt) as station_pt,
            count(*) AS trip_count
        FROM `indego-bikeshare-tools.core.indego_trips`
        WHERE EXTRACT(HOUR FROM end_time) BETWEEN {start_hour} AND {end_hour}
        GROUP BY end_station, end_date
    ),

    average_trip_count AS (
        SELECT
            station_id,
            ANY_VALUE(o.station_pt) AS station_pt,
            AVG(o.trip_count) AS P_o,
            AVG(d.trip_count) AS P_d
        FROM daily_origin_trip_count AS o
        JOIN daily_destination_trip_count AS d USING (station_id, trip_date)
        GROUP BY station_id
    )

    SELECT
        station_id,
        st_asgeojson(station_pt) as geometry,
        P_o,
        P_d,
        P_o + P_d AS P
    FROM average_trip_count
    '''

    # Run the SQL against BigQuery
    client = bigquery.Client(project='indego-bikeshare-tools')
    rows = client.query_and_wait(sql)

    # Convert the rows to a list of dictionaries. This will be the data
    # that I return to the client.
    data = [
        {
            'station_id': row.station_id,
            'geometry': row.geometry,
            'P_o': row.P_o,
            'P_d': row.P_d,
            'P': row.P,
        }
        for row in rows
    ]

    # The usual HTTP status code for a successful request with data is 200.
    status_code = 200

    # Set CORS headers to allow cross-origin requests. This is necessary
    # because the API is hosted on a different domain than the front-end.
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
    }

    # Finally, I return a tuple of the data, status code, and headers.
    # Flask will take care of converting the data to JSON and setting the
    # Content-Type header to application/json, as long as I give it a list
    # or a dictionary.
    return data, status_code, headers
