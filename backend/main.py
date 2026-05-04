"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routers import albums, artists, auth, comparison, featured, feed, leaderboard, ratings, reviews, saved_comparisons, tracks, users

app = FastAPI(
    title="Contour — Stream Trajectory Comparison",
    version="0.1.0",
    description="Compare album streaming trajectories normalized against Spotify MAU.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://contour-rosy.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router)
app.include_router(albums.router)
app.include_router(tracks.router)
app.include_router(artists.router)
app.include_router(comparison.router)
app.include_router(ratings.router)
app.include_router(saved_comparisons.router)
app.include_router(featured.router)
app.include_router(feed.router)
app.include_router(reviews.router)
app.include_router(users.router)
app.include_router(leaderboard.router)


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok"}
