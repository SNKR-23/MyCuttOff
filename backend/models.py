from pydantic import BaseModel, Field
from typing import Optional, List

class PredictionRequest(BaseModel):
    category: str = Field(..., description="Student's reservation category (OC, BC, BCM, MBC, SC, SCA, ST)")
    student_mark: float = Field(..., ge=0, le=200, description="Student's cutoff mark (0-200)")
    college_id: Optional[int] = Field(None, alias="college_code", description="Optional college code to filter results")
    branch_id: Optional[str] = Field(None, alias="branch_name", description="Optional branch name to filter results")
    top_n: Optional[int] = 100
    min_probability: Optional[float] = 10.0

class BranchResultItem(BaseModel):
    branch_name: str
    predicted_cutoff: float
    student_mark: float
    mark_gap: float
    probability_percentage: float
    confidence_level: str
    college_id: int
    branch_id: str

class CollegeGroupItem(BaseModel):
    college_code: int
    college_name: str
    num_branches: Optional[int] = None
    avg_oc_cutoff: Optional[float] = None
    best_probability: float
    branches: List[BranchResultItem]

class PredictionResponse(BaseModel):
    grouped: List[CollegeGroupItem]
    message: str
