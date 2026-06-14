import pandas as pd
import numpy as np
import os
import sqlite3
from sqlalchemy import create_engine

# Database Connection (Using SQLite for local development)
DB_FILE = "../admission_db.sqlite"
DB_URI = f"sqlite:///{DB_FILE}"

CATEGORIES = ['OC', 'BC', 'BCM', 'MBC', 'SC', 'SCA', 'ST']


def process_and_load_data(csv_path: str):
    """
    Reads the cleaned Cutoff_dataset.csv (already combined across years),
    which now includes the extra feature columns:
      - Year        : the TNEA year
      - num_branches: total number of branches offered by that college (grouped by college code)
      - avg_oc_cutoff: average OC cutoff for that college across all branches in that year

    Normalises colleges/branches, melts wide category columns to long format,
    cleans marks, and loads everything into an SQLite database.
    """
    db_abs_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), DB_FILE)
    if os.path.exists(db_abs_path):
        try:
            os.remove(db_abs_path)
            print(f"Removed old database file: {db_abs_path}")
        except Exception as e:
            print(f"Could not remove old database: {e}. Continuing anyway.")

    # ------------------------------------------------------------------
    # Step 1 – Load CSV
    # ------------------------------------------------------------------
    print("Step 1: Loading Cutoff_dataset.csv ...")
    df = pd.read_csv(csv_path)

    # Normalise column names to be consistent regardless of CSV capitalisation
    df.columns = [c.strip() for c in df.columns]

    # Map flexible column names to our internal names
    col_map = {
        'Code': 'college_code',
        'College Name': 'college_name',
        'Branch': 'branch_name',
        'Year': 'year',
        'num_branches': 'num_branches',
        'avg_oc_cutoff': 'avg_oc_cutoff',
    }
    df.rename(columns=col_map, inplace=True)

    # Make sure all category columns exist
    for cat in CATEGORIES:
        if cat not in df.columns:
            df[cat] = np.nan

    print(f"  Loaded {len(df):,} raw rows covering years: {sorted(df['year'].dropna().unique().astype(int).tolist())}")

    # ------------------------------------------------------------------
    # Step 2 – Basic cleaning
    # ------------------------------------------------------------------
    print("Step 2: Cleaning data ...")

    df['college_code'] = df['college_code'].astype(str).str.strip().str.replace(r'\.0$', '', regex=True)
    df['college_name'] = df['college_name'].astype(str).str.strip().apply(lambda x: ' '.join(x.split()))
    df['branch_name']  = df['branch_name'].astype(str).str.upper().str.strip().apply(lambda x: ' '.join(x.split()))
    df['year']         = pd.to_numeric(df['year'], errors='coerce').astype('Int64')
    df['num_branches'] = pd.to_numeric(df['num_branches'], errors='coerce')
    df['avg_oc_cutoff']= pd.to_numeric(df['avg_oc_cutoff'], errors='coerce')

    # ------------------------------------------------------------------
    # Step 3 – Melt category columns to long format
    # ------------------------------------------------------------------
    print("Step 3: Melting category columns to long format ...")
    id_vars = ['college_code', 'college_name', 'branch_name', 'year', 'num_branches', 'avg_oc_cutoff']
    melted = pd.melt(
        df,
        id_vars=id_vars,
        value_vars=CATEGORIES,
        var_name='category',
        value_name='closing_mark'
    )

    # Clean marks — remove asterisks, replace dashes with NaN, coerce to float
    melted['closing_mark'] = (
        melted['closing_mark']
        .astype(str).str.strip()
        .str.replace('*', '', regex=False)
        .replace('-', np.nan)
    )
    melted['closing_mark'] = pd.to_numeric(melted['closing_mark'], errors='coerce')

    # Drop rows with no cutoff value
    melted.dropna(subset=['closing_mark'], inplace=True)

    print(f"  Total clean records after melting: {len(melted):,}")

    # ------------------------------------------------------------------
    # Step 4 – Build normalised dimension tables
    # ------------------------------------------------------------------
    print("Step 4: Building college & branch dimension tables ...")
    db_uri_path = db_abs_path.replace('\\', '/')
    engine = create_engine(f"sqlite:///{db_uri_path}")

    # --- Colleges ---
    college_name_map: dict[str, str] = {}
    for code, grp in melted.groupby('college_code'):
        best_name = sorted(grp['college_name'].dropna().unique(), key=len, reverse=True)[0]
        college_name_map[str(code)] = best_name

    colleges_df = pd.DataFrame([
        {'college_code': code, 'college_name': name}
        for code, name in college_name_map.items()
    ])
    colleges_df.index = range(1, len(colleges_df) + 1)
    colleges_df.index.name = 'id'
    colleges_df.to_sql('colleges', engine, if_exists='replace', index=True, index_label='id')

    # --- Branches ---
    branches_df = melted[['branch_name']].drop_duplicates().reset_index(drop=True)
    branches_df['branch_code'] = ['B' + str(i).zfill(3) for i in range(1, len(branches_df) + 1)]
    branches_df.index = range(1, len(branches_df) + 1)
    branches_df.index.name = 'id'
    branches_df.to_sql('branches', engine, if_exists='replace', index=True, index_label='id')

    # ------------------------------------------------------------------
    # Step 5 – Build historical_cutoffs fact table
    # ------------------------------------------------------------------
    print("Step 5: Populating historical_cutoffs table ...")
    college_mapping = colleges_df.reset_index().set_index('college_code')['id'].to_dict()
    branch_mapping  = branches_df.reset_index().set_index('branch_name')['id'].to_dict()

    melted['college_id'] = melted['college_code'].map(college_mapping)
    melted['branch_id']  = melted['branch_name'].map(branch_mapping)

    historical_cutoffs = melted[[
        'college_id', 'branch_id', 'category', 'year',
        'num_branches', 'avg_oc_cutoff', 'closing_mark'
    ]].copy()

    historical_cutoffs.to_sql('historical_cutoffs', engine, if_exists='replace', index=False)

    print("[OK] Database built successfully!")
    print(f"  Colleges      : {len(colleges_df):,}")
    print(f"  Branches      : {len(branches_df):,}")
    print(f"  Cutoff records: {len(historical_cutoffs):,}")

    return melted


if __name__ == "__main__":
    csv_file = os.path.join(os.path.dirname(__file__), "raw_cutoffs", "Cutoff_dataset.csv")
    if not os.path.exists(csv_file):
        print(f"ERROR: Dataset not found at {csv_file}")
    else:
        process_and_load_data(csv_file)
