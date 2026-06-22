from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from app.core.settings import settings
from app.routers import admin, documents

app = FastAPI(title="PromptPatrol API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin.router)
app.include_router(documents.router)

# AWS Lambda entry point. Ignored when running locally under uvicorn; API
# Gateway invokes this handler, which adapts the event to the ASGI `app`.
handler = Mangum(app)