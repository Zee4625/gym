"""OPTIONAL. You do NOT need Flask for the site on GitHub Pages: the pages talk to Supabase directly from the browser.
Use this file only if you want to (a) preview the site locally at http://127.0.0.1:5000 or (b) host a Flask API somewhere
else (Render, PythonAnywhere, ...). GitHub Pages cannot run Python.
Setup:  pip install -r requirements.txt   then copy .env.example to .env   then  python app.py
Only the PUBLISHABLE key goes in .env here. Never use the secret / service_role key in a file you commit."""
import os
from flask import Flask, jsonify, abort, send_from_directory
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
app = Flask(__name__, static_folder=None)
SITE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ALLOWED = {".html", ".css", ".js", ".jpeg", ".jpg", ".png", ".svg", ".ico"}

supabase: Client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])


@app.after_request
def headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


@app.get("/api/leaderboard")
def leaderboard():
    # same query the browser runs; reading is public (Row Level Security allows SELECT for everyone)
    res = (supabase.table("leaderboard")
           .select("user_id,name,bio,soc,score,scores,avatar,updated_at")
           .order("score", desc=True).limit(300).execute())
    return jsonify(res.data)


@app.get("/")
@app.get("/<path:name>")
def site(name="index.html"):
    # only plain files from the site folder with an allowed extension (no sub-folders, no .env, no python-flask/ folder)
    if "/" in name or "\\" in name or name.startswith(".") or os.path.splitext(name)[1].lower() not in ALLOWED:
        abort(404)
    return send_from_directory(SITE, name)


if __name__ == "__main__":
    app.run(debug=True)
