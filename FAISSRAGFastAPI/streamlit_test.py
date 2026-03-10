"""
Streamlit Test App for RAG Story Engine (main.py)
Run with: streamlit run streamlit_test.py
"""

import streamlit as st
import requests
import json
from pathlib import Path

# ── Page Config ────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="RAG Story Engine Tester",
    page_icon="📖",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Custom CSS ─────────────────────────────────────────────────────────────────
st.markdown("""
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Mono&family=DM+Sans:wght@300;400;500&display=swap');

  html, body, [class*="css"] { font-family: 'DM Sans', sans-serif; }

  h1, h2, h3 { font-family: 'Playfair Display', serif !important; }

  .stButton > button {
    background: #e8c97a !important;
    color: #0d0d0f !important;
    border: none !important;
    border-radius: 8px !important;
    font-weight: 500 !important;
    padding: 0.55rem 1.5rem !important;
    transition: filter 0.2s !important;
  }
  .stButton > button:hover { filter: brightness(1.1); }

  .status-ok {
    background: rgba(122,232,168,0.12);
    color: #7ae8a8;
    padding: 0.3rem 0.9rem;
    border-radius: 20px;
    font-family: 'DM Mono', monospace;
    font-size: 0.78rem;
    display: inline-block;
  }
  .status-err {
    background: rgba(232,122,122,0.12);
    color: #e87a7a;
    padding: 0.3rem 0.9rem;
    border-radius: 20px;
    font-family: 'DM Mono', monospace;
    font-size: 0.78rem;
    display: inline-block;
  }
  .story-box {
    background: #141418;
    border: 1px solid #242430;
    border-radius: 10px;
    padding: 2rem 2.5rem;
    font-family: 'Playfair Display', serif;
    font-size: 1.05rem;
    line-height: 1.9;
    color: #e8e4dc;
    white-space: pre-wrap;
  }
  .metric-card {
    background: #141418;
    border: 1px solid #242430;
    border-radius: 8px;
    padding: 1rem 1.2rem;
    text-align: center;
  }
  .metric-val {
    font-family: 'DM Mono', monospace;
    font-size: 1.5rem;
    color: #e8c97a;
  }
  .metric-lbl {
    font-size: 0.72rem;
    color: #6b6878;
    margin-top: 0.2rem;
  }
  code { font-family: 'DM Mono', monospace !important; }
</style>
""", unsafe_allow_html=True)


# ── State Defaults ─────────────────────────────────────────────────────────────
if "log" not in st.session_state:
    st.session_state.log = []
if "story" not in st.session_state:
    st.session_state.story = ""
if "sources" not in st.session_state:
    st.session_state.sources = []
if "health_data" not in st.session_state:
    st.session_state.health_data = None


# ── Helpers ────────────────────────────────────────────────────────────────────
def add_log(message: str, level: str = "INFO"):
    import datetime
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    st.session_state.log.append({"ts": ts, "level": level, "msg": message})


def get_base_url():
    return st.session_state.get("base_url", "http://localhost:8000").rstrip("/")


def check_health():
    url = f"{get_base_url()}/health"
    add_log(f"GET {url}")
    try:
        r = requests.get(url, timeout=5)
        data = r.json()
        st.session_state.health_data = data
        add_log(f"Health: {data.get('status')} — {data.get('indexed_chunks', 0)} chunks", "OK")
        return data
    except Exception as e:
        add_log(f"Health check failed: {e}", "ERR")
        st.session_state.health_data = None
        return None


# ── Sidebar ────────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("## ⚙️ Configuration")

    base_url = st.text_input(
        "API Base URL",
        value="http://localhost:8000",
        key="base_url",
        placeholder="http://localhost:8000",
    )

    if st.button("↺ Check Health", use_container_width=True):
        check_health()

    # Health badge
    hd = st.session_state.health_data
    if hd:
        ok = hd.get("status") == "healthy"
        badge_class = "status-ok" if ok else "status-err"
        label = f"● {hd['status']} · {hd.get('indexed_chunks', 0)} chunks"
        st.markdown(f'<div class="{badge_class}">{label}</div>', unsafe_allow_html=True)
    else:
        st.markdown('<div class="status-err">● not connected</div>', unsafe_allow_html=True)

    st.divider()

    st.markdown("## 📄 Upload Document")
    uploaded_file = st.file_uploader(
        "Choose a PDF or EPUB",
        type=["pdf", "epub"],
        label_visibility="collapsed",
    )

    if uploaded_file:
        st.caption(f"📎 {uploaded_file.name} ({uploaded_file.size // 1024} KB)")
        if st.button("⬆ Upload to API", use_container_width=True):
            with st.spinner("Uploading…"):
                try:
                    files = {"file": (uploaded_file.name, uploaded_file.getvalue(),
                                      "application/pdf" if uploaded_file.name.endswith(".pdf") else "application/epub+zip")}
                    r = requests.post(f"{get_base_url()}/api/v1/upload", files=files, timeout=60)
                    data = r.json()
                    if r.ok:
                        st.success(f"✓ {data['chunks']} chunks indexed")
                        add_log(f"Upload OK — {data['chunks']} chunks, id: {data['file_id'][:8]}…", "OK")
                        check_health()
                    else:
                        st.error(f"✗ {data.get('detail', r.status_code)}")
                        add_log(f"Upload failed: {data.get('detail')}", "ERR")
                except Exception as e:
                    st.error(str(e))
                    add_log(f"Upload exception: {e}", "ERR")

    st.divider()

    st.markdown("## 🎚 Story Settings")
    age_group = st.selectbox("Age Group", ["2-3", "4-6", "7-9", "10-12"], index=1)
    story_length = st.selectbox(
        "Story Length",
        ["5_minutes", "10_minutes", "15_minutes"],
        index=1,
        format_func=lambda x: {"5_minutes": "5 min (~700 words)",
                                "10_minutes": "10 min (~1400 words)",
                                "15_minutes": "15 min (~2100 words)"}[x],
    )
    temperature = st.slider("Temperature", 0.0, 1.0, 0.7, 0.05)


# ── Main Area ──────────────────────────────────────────────────────────────────
st.markdown("# 📖 RAG Story Engine Tester")
st.caption("Test your `main.py` FastAPI backend — upload documents, generate stories, monitor health.")

tab_gen, tab_health, tab_log, tab_raw = st.tabs(["✦ Generate", "❤ Health", "🗒 Log", "{ } Raw API"])


# ── Tab: Generate ──────────────────────────────────────────────────────────────
with tab_gen:
    prompt = st.text_area(
        "Story Prompt",
        placeholder="e.g. A brave little fox who learns to share with her forest friends…",
        height=100,
    )

    col1, col2 = st.columns([1, 4])
    with col1:
        generate_clicked = st.button("✦ Generate Story", use_container_width=True)
    with col2:
        st.caption("Tip: make sure you've uploaded at least one document first for best results.")

    if generate_clicked:
        if not prompt.strip():
            st.warning("Please enter a story prompt.")
        else:
            payload = {
                "prompt": prompt.strip(),
                "age_group": age_group,
                "story_length": story_length,
                "temperature": temperature,
            }
            add_log(f"POST /api/v1/generate — \"{prompt[:50]}…\"")

            with st.spinner("Weaving your story… ✨"):
                try:
                    r = requests.post(
                        f"{get_base_url()}/api/v1/generate",
                        json=payload,
                        timeout=120,
                    )
                    data = r.json()
                    if r.ok:
                        st.session_state.story = data.get("story", "")
                        st.session_state.sources = data.get("sources", [])
                        word_count = len(st.session_state.story.split())
                        add_log(f"Story generated — {word_count} words", "OK")
                    else:
                        st.error(f"API error: {data.get('detail', r.status_code)}")
                        add_log(f"Generation failed: {data.get('detail')}", "ERR")
                except Exception as e:
                    st.error(str(e))
                    add_log(f"Generation exception: {e}", "ERR")

    if st.session_state.story:
        word_count = len(st.session_state.story.split())

        # Word count metric
        st.markdown(f"""
        <div style="display:flex; gap:1rem; margin-bottom:1rem;">
            <div class="metric-card"><div class="metric-val">{word_count}</div><div class="metric-lbl">Words</div></div>
            <div class="metric-card"><div class="metric-val">{len(st.session_state.sources)}</div><div class="metric-lbl">Sources</div></div>
            <div class="metric-card"><div class="metric-val">{round(word_count/200)} min</div><div class="metric-lbl">Read time</div></div>
        </div>
        """, unsafe_allow_html=True)

        # Story box
        story_escaped = st.session_state.story.replace("<", "&lt;").replace(">", "&gt;")
        st.markdown(f'<div class="story-box">{story_escaped}</div>', unsafe_allow_html=True)

        # Sources
        if st.session_state.sources:
            st.markdown("**Sources used:**")
            st.markdown(" · ".join([f"`{s}`" for s in st.session_state.sources if s]))

        # Download
        st.download_button(
            "⬇ Download Story",
            data=st.session_state.story,
            file_name="story.txt",
            mime="text/plain",
        )


# ── Tab: Health Monitor ────────────────────────────────────────────────────────
with tab_health:
    st.markdown("### System Health")

    if st.button("Refresh", key="refresh_health"):
        check_health()

    hd = st.session_state.health_data
    if hd:
        ok = hd.get("status") == "healthy"
        col1, col2, col3 = st.columns(3)

        with col1:
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-val" style="color:{'#7ae8a8' if ok else '#e87a7a'}">{hd.get('status','—')}</div>
                <div class="metric-lbl">API Status</div>
            </div>
            """, unsafe_allow_html=True)
        with col2:
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-val">{hd.get('indexed_chunks', '—')}</div>
                <div class="metric-lbl">Indexed Chunks</div>
            </div>
            """, unsafe_allow_html=True)
        with col3:
            model_ok = not hd.get("error_details")
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-val" style="color:{'#7ae8a8' if model_ok else '#e87a7a'}">{'ready' if model_ok else 'error'}</div>
                <div class="metric-lbl">Embedding Model</div>
            </div>
            """, unsafe_allow_html=True)

        if hd.get("error_details"):
            st.error(f"Error details: {hd['error_details']}")
    else:
        st.info("No health data yet. Click **Refresh** or **Check Health** in the sidebar.")


# ── Tab: Log ───────────────────────────────────────────────────────────────────
with tab_log:
    col1, col2 = st.columns([3, 1])
    with col1:
        st.markdown("### Request Log")
    with col2:
        if st.button("Clear Log"):
            st.session_state.log = []
            st.rerun()

    if not st.session_state.log:
        st.caption("No requests yet.")
    else:
        log_text = "\n".join(
            [f"[{e['ts']}] [{e['level']:>4}] {e['msg']}" for e in reversed(st.session_state.log)]
        )
        st.code(log_text, language=None)


# ── Tab: Raw API ───────────────────────────────────────────────────────────────
with tab_raw:
    st.markdown("### Manual API Request")
    st.caption("Send a raw JSON payload to any endpoint.")

    endpoint = st.selectbox(
        "Endpoint",
        [
            "GET /health",
            "POST /api/v1/generate",
        ],
    )

    default_payloads = {
        "GET /health": None,
        "POST /api/v1/generate": json.dumps({
            "prompt": "A curious penguin explores a desert",
            "age_group": "4-6",
            "story_length": "5_minutes",
            "temperature": 0.7
        }, indent=2),
    }

    raw_body = None
    if "POST" in endpoint:
        raw_body = st.text_area("JSON Body", value=default_payloads.get(endpoint, "{}"), height=160)

    if st.button("▶ Send Request", key="raw_send"):
        method, path = endpoint.split(" ", 1)
        url = f"{get_base_url()}{path}"
        add_log(f"{method} {url} (raw)")
        try:
            if method == "GET":
                r = requests.get(url, timeout=10)
            else:
                body = json.loads(raw_body)
                r = requests.post(url, json=body, timeout=120)

            st.markdown(f"**Status:** `{r.status_code}`")
            st.json(r.json())
            add_log(f"Raw response {r.status_code}", "OK" if r.ok else "ERR")
        except json.JSONDecodeError:
            st.error("Invalid JSON body.")
        except Exception as e:
            st.error(str(e))
            add_log(f"Raw request error: {e}", "ERR")


# ── Footer ─────────────────────────────────────────────────────────────────────
st.divider()
st.caption("RAG Story Engine Test Client · Built for `main.py` FastAPI backend")
