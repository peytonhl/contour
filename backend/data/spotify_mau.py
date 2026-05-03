"""
Spotify Monthly Active Users by year (from public annual reports).
Monthly values are linearly interpolated between annual anchor points.
"""

from datetime import date
from typing import Dict

# Annual MAU in millions, keyed by year
ANNUAL_MAU: Dict[int, float] = {
    2015: 75,
    2016: 100,
    2017: 140,
    2018: 191,
    2019: 232,
    2020: 345,
    2021: 406,
    2022: 456,
    2023: 602,
    2024: 678,
    2025: 750,  # estimate
}

MIN_YEAR = min(ANNUAL_MAU)
MAX_YEAR = max(ANNUAL_MAU)


def get_mau_for_date(d: date) -> float:
    """
    Return interpolated Spotify MAU (in millions) for the given date.
    Clamps to the known range [2015, 2025].
    """
    year = max(MIN_YEAR, min(MAX_YEAR, d.year))

    if year == MAX_YEAR:
        return ANNUAL_MAU[MAX_YEAR]

    # Linear interpolation within the year
    start_mau = ANNUAL_MAU[year]
    end_mau = ANNUAL_MAU[year + 1]

    # Fraction of the year elapsed
    year_start = date(year, 1, 1)
    year_end = date(year + 1, 1, 1)
    elapsed = (d - year_start).days
    total_days = (year_end - year_start).days
    fraction = elapsed / total_days

    return start_mau + (end_mau - start_mau) * fraction
