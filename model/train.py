"""
Single Model XGBoost Regressor Training Pipeline
-------------------------------------------------
Strategy:
  - The dataset is now in Long Format (melted).
  - We train a SINGLE XGBoost regression model for all categories.
  - Features: Code, branch_encoded, Year, num_branches, community_encoded.
"""

import pandas as pd
import numpy as np
import os
import joblib
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import mean_absolute_error, r2_score
from xgboost import XGBRegressor

DATASET_PATH = "../data/raw_cutoffs/ML_Ready_Cutoff_Dataset.csv"
ARTIFACTS_DIR = "artifacts"

def train_model():
    print("=" * 60)
    print("  Single Model XGBoost Training Pipeline")
    print("=" * 60)

    # ── Step 1: Load the full dataset ──
    print("\nStep 1: Loading dataset...")
    df = pd.read_csv(DATASET_PATH)
    print(f"  Total records in dataset: {len(df)}")
    print(f"  Columns: {df.columns.tolist()}")
    print(f"  Years covered: {sorted(df['Year'].unique())}")

    # ── Step 2: Encode categorical features ──
    print("\nStep 2: Encoding features...")
    branch_encoder = LabelEncoder()
    df['branch_encoded'] = branch_encoder.fit_transform(df['Branch'])

    community_encoder = LabelEncoder()
    df['community_encoded'] = community_encoder.fit_transform(df['Community'])

    # Features used for the model
    feature_cols = ['Code', 'branch_encoded', 'Year', 'num_branches', 'community_encoded']
    
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)

    # Save the encoders
    joblib.dump(branch_encoder, os.path.join(ARTIFACTS_DIR, 'branch_encoder.pkl'))
    print(f"  Saved branch_encoder.pkl ({len(branch_encoder.classes_)} branches)")
    
    joblib.dump(community_encoder, os.path.join(ARTIFACTS_DIR, 'community_encoder.pkl'))
    print(f"  Saved community_encoder.pkl ({len(community_encoder.classes_)} communities)")

    # ── Step 3: Train single model ──
    print("\nStep 3: Training model...\n")
    
    X = df[feature_cols]
    y = df['Cutoff_Mark']

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.1, random_state=42
    )

    model = XGBRegressor(
        n_estimators=500,
        max_depth=10,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        random_state=42,
        tree_method='hist'
    )

    model.fit(X_train, y_train)

    # Evaluate
    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)
    print(f"  Evaluation:")
    print(f"    MAE: +/-{mae:.2f} marks")
    print(f"    R2:  {r2 * 100:.2f}%")

    # Save model
    model_path = os.path.join(ARTIFACTS_DIR, 'xgb_model.pkl')
    joblib.dump(model, model_path)
    print(f"\n  Saved model -> {model_path}")
    print("Done!")

if __name__ == "__main__":
    train_model()
