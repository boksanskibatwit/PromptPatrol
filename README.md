# PromptPatrol
PromptPatrol is an enterprise-grade AI governance tool designed for financial companies operating under FTC data privacy regulations. The system enforces a structured, auditable workflow that governs how customer information is submitted to AI models. This ensures every interaction is authenticated, reviewed, approved, and then recorded before any sensitive data leaves the organization's network. 

## Web
To run web commmands

install node.ns from web https://nodejs.org/en/download

-reload vs code
-npm install

TO RUN WEBSITE be in ./web
-npm run dev 

## Backend

**Prerequisites:** Python 3.11+. Copy `.env` from the team OneDrive into the `backend/` folder before starting.

### First-time setup


cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt


### Start the server


cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload

The API runs at `http://localhost:8000`. The `--reload` flag restarts automatically when you save a file.
