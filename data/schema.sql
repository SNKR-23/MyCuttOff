CREATE TABLE Colleges (
    id SERIAL PRIMARY KEY,
    college_code VARCHAR(50) UNIQUE NOT NULL,
    college_name VARCHAR(255) NOT NULL,
    location VARCHAR(255)
);

CREATE TABLE Branches (
    id SERIAL PRIMARY KEY,
    branch_code VARCHAR(50) UNIQUE NOT NULL,
    branch_name VARCHAR(255) NOT NULL
);

CREATE TABLE Historical_Cutoffs (
    id SERIAL PRIMARY KEY,
    college_id INTEGER REFERENCES Colleges(id),
    branch_id INTEGER REFERENCES Branches(id),
    category VARCHAR(50) NOT NULL,
    year INTEGER NOT NULL,
    closing_mark DECIMAL(5,2) NOT NULL,
    closing_rank INTEGER
);

CREATE TABLE Predictions_Logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    student_marks DECIMAL(5,2),
    student_category VARCHAR(50),
    preferred_branch_id INTEGER REFERENCES Branches(id),
    prediction_probability DECIMAL(5,4)
);
