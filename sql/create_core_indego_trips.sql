CREATE OR REPLACE TABLE core.indego_trips AS (
    SELECT
        *,
        S2_CELLIDFROMPOINT(start_pt, 12) AS start_s2r12,
        S2_CELLIDFROMPOINT(start_pt, 13) AS start_s2r13,
        S2_CELLIDFROMPOINT(start_pt, 14) AS start_s2r14,
        S2_CELLIDFROMPOINT(start_pt, 15) AS start_s2r15,
        S2_CELLIDFROMPOINT(start_pt, 16) AS start_s2r16,
        S2_CELLIDFROMPOINT(end_pt, 12) AS end_s2r12,
        S2_CELLIDFROMPOINT(end_pt, 13) AS end_s2r13,
        S2_CELLIDFROMPOINT(end_pt, 14) AS end_s2r14,
        S2_CELLIDFROMPOINT(end_pt, 15) AS end_s2r15,
        S2_CELLIDFROMPOINT(end_pt, 16) AS end_s2r16,
        EXTRACT(DATE FROM start_time) AS start_date,
        EXTRACT(DATE FROM end_time) AS end_date,
    FROM source.indego_trips
)