import math
import os
import joblib
import pandas as pd
from collections import defaultdict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import PredictionRequest, PredictionResponse, CollegeGroupItem, BranchResultItem

app = FastAPI(title="Admission Prediction API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ARTIFACTS_DIR = '../model/artifacts'
DATASET_PATH = '../data/raw_cutoffs/ML_Ready_Cutoff_Dataset.csv'

model = None
branch_encoder = None
community_encoder = None
college_branch_lookup = None
avg_oc_cutoffs = {}

try:
    branch_encoder = joblib.load(os.path.join(ARTIFACTS_DIR, 'branch_encoder.pkl'))
    community_encoder = joblib.load(os.path.join(ARTIFACTS_DIR, 'community_encoder.pkl'))
    
    model_path = os.path.join(ARTIFACTS_DIR, 'xgb_model.pkl')
    if os.path.exists(model_path):
        model = joblib.load(model_path)
        print("Loaded unified XGBoost model.")

    # Preload dataset for college/branch lookup (lightweight, just metadata)
    df = pd.read_csv(DATASET_PATH)
    
    # Calculate avg OC cutoffs per college
    oc_df = df[df['Community'] == 'OC']
    avg_oc_cutoffs = oc_df.groupby('Code')['Cutoff_Mark'].mean().to_dict()
    
    # Get unique college-branch combos with their metadata
    college_branch_lookup = df[['Code', 'College Name', 'Branch', 'num_branches']].drop_duplicates(subset=['Code', 'Branch'])
    college_branch_lookup['branch_encoded'] = branch_encoder.transform(college_branch_lookup['Branch'])
    print(f"Loaded {len(college_branch_lookup)} unique college-branch combinations.")

except Exception as e:
    print(f"Warning: Could not load models/data. {e}")


@app.get("/")
def read_root():
    return {"message": "Admission Prediction API is running!"}


@app.get("/colleges")
def get_colleges():
    """Fetch list of all colleges with their codes"""
    if college_branch_lookup is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    colleges = college_branch_lookup[['Code', 'College Name']].drop_duplicates(subset=['Code']).sort_values('College Name')
    # Use id to be compatible with frontend expectations
    return [{"id": int(row['Code']), "code": str(row['Code']), "name": row['College Name']} for _, row in colleges.iterrows()]


@app.get("/branches")
def get_branches():
    """Fetch list of all branches"""
    if college_branch_lookup is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    branches = college_branch_lookup[['Branch']].drop_duplicates().sort_values('Branch')
    return [{"id": row['Branch'], "name": row['Branch']} for _, row in branches.iterrows()]


@app.post("/predict", response_model=PredictionResponse)
def predict_admission(req: PredictionRequest):
    """
    Predict admission probability.
    - Mandatory: student_mark, category
    - Optional: college_id (code), branch_id (name)
    """
    try:
        if model is None or community_encoder is None:
             raise HTTPException(status_code=500, detail="Model is not loaded.")

        cat = req.category.upper()
        if cat not in community_encoder.classes_:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid category '{req.category}'."
            )
        
        cat_encoded = community_encoder.transform([cat])[0]

        filtered = college_branch_lookup.copy()

        if req.college_id is not None:
            filtered = filtered[filtered['Code'] == req.college_id]
        if req.branch_id is not None:
            filtered = filtered[filtered['Branch'].str.contains(req.branch_id, case=False, na=False)]

        if filtered.empty:
            return PredictionResponse(grouped=[], message="No matching colleges/branches found.")

        # Prepare features for bulk prediction
        input_data = pd.DataFrame({
            'Code': filtered['Code'].values,
            'branch_encoded': filtered['branch_encoded'].values,
            'Year': 2025,
            'num_branches': filtered['num_branches'].values,
            'community_encoded': cat_encoded
        })

        # Predict cutoffs in bulk
        predicted_cutoffs = model.predict(input_data)

        groups = defaultdict(list)
        college_metadata = {}

        k = 0.2  # Scaling factor for sigmoid
        for i, (_, row) in enumerate(filtered.iterrows()):
            predicted_cutoff = float(predicted_cutoffs[i])
            diff = req.student_mark - predicted_cutoff

            probability = 1 / (1 + math.exp(-k * diff))
            prob_percentage = round(probability * 100, 2)

            if prob_percentage < req.min_probability and not (req.college_id or req.branch_id):
                continue

            if prob_percentage >= 80:
                confidence = "High (Safe)"
            elif prob_percentage >= 50:
                confidence = "Medium (Competitive)"
            else:
                confidence = "Low (Reach)"

            code = int(row['Code'])
            if code not in college_metadata:
                college_metadata[code] = {
                    'name': row['College Name'],
                    'num_branches': int(row['num_branches'])
                }

            groups[code].append(BranchResultItem(
                branch_name=row['Branch'],
                predicted_cutoff=round(predicted_cutoff, 2),
                student_mark=round(req.student_mark, 2),
                mark_gap=round(diff, 2),
                probability_percentage=prob_percentage,
                confidence_level=confidence,
                college_id=code,
                branch_id=row['Branch']
            ))

        grouped_results = []
        for code, branches in groups.items():
            # Sort branches within college by probability descending
            branches.sort(key=lambda x: x.probability_percentage, reverse=True)
            best_prob = branches[0].probability_percentage
            
            grouped_results.append(CollegeGroupItem(
                college_code=code,
                college_name=college_metadata[code]['name'],
                num_branches=college_metadata[code]['num_branches'],
                avg_oc_cutoff=round(avg_oc_cutoffs.get(code, 0.0), 2) if code in avg_oc_cutoffs else None,
                best_probability=best_prob,
                branches=branches
            ))

        # Sort colleges by best probability descending
        grouped_results.sort(key=lambda x: x.best_probability, reverse=True)
        
        # Limit top N
        grouped_results = grouped_results[:req.top_n]

        msg = f"Found matches in {len(grouped_results)} colleges for {cat} category."
        return PredictionResponse(grouped=grouped_results, message=msg)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/trends")
def get_trends(college_id: int, branch_id: str, category: str):
    """Fetch historical trends for a college-branch-category combo."""
    try:
        df = pd.read_csv(DATASET_PATH)
        filtered = df[(df['Code'] == college_id) & (df['Branch'] == branch_id) & (df['Community'] == category.upper())]
        
        if filtered.empty:
            raise HTTPException(status_code=404, detail="No historical data found.")
            
        trends = [{"year": int(row['Year']), "closing_mark": float(row['Cutoff_Mark'])} for _, row in filtered.iterrows()]
        trends.sort(key=lambda x: x['year'])
        
        return {
            "college_id": college_id,
            "college_name": filtered.iloc[0]['College Name'],
            "branch_id": branch_id,
            "branch_name": branch_id,
            "trends": trends
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
