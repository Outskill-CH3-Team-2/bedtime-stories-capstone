import os
import re
import requests

GDRIVE_DOWNLOAD_URL = "https://drive.usercontent.google.com/download"


def get_direct_url(sharing_url: str) -> str | None:
    """Converts a standard GDrive sharing link to a direct download URL."""
    match = re.search(r'/d/([a-zA-Z0-9_-]+)', sharing_url)
    if not match:
        return None
    file_id = match.group(1)
    # drive.usercontent.google.com handles large files without the
    # virus-scan confirmation page that docs.google.com/uc hits.
    return f"{GDRIVE_DOWNLOAD_URL}?id={file_id}&export=download&confirm=t"


def download_file(url: str, dest_path: str) -> bool:
    """Downloads a file from *url* and writes it to *dest_path*. Returns True on success."""
    session = requests.Session()
    response = session.get(url, stream=True, timeout=120)

    # GDrive may redirect to a confirmation page for large files – follow it.
    if response.status_code == 200 and "text/html" in response.headers.get("Content-Type", ""):
        # Extract the confirmed download URL from the HTML body
        content = response.content.decode("utf-8", errors="ignore")
        confirm_match = re.search(r'href="(/download\?[^"]+)"', content)
        if confirm_match:
            confirmed_url = "https://drive.usercontent.google.com" + confirm_match.group(1).replace("&amp;", "&")
            response = session.get(confirmed_url, stream=True, timeout=120)

    if response.status_code != 200:
        print(f"  Failed (HTTP {response.status_code})")
        return False

    os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
    with open(dest_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=65536):
            if chunk:
                f.write(chunk)

    # Validate downloaded file
    file_size = os.path.getsize(dest_path)
    content_type = response.headers.get("Content-Type", "")
    print(f"  downloaded: {file_size:,} bytes  content-type={content_type}")

    # Detect HTML error pages saved as binary files
    if file_size < 10_000 and dest_path.endswith((".mp4", ".mp3", ".png", ".jpg")):
        print(f"  WARNING: {dest_path} is suspiciously small ({file_size} bytes) — possible failed download")
        os.remove(dest_path)
        return False

    return True


def download_if_missing(properties_path: str, target_dir: str) -> None:
    """Reads a .properties file and downloads any files not already on disk."""
    os.makedirs(target_dir, exist_ok=True)

    with open(properties_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or "=" not in line:
                continue
            filename, sharing_url = line.split("=", 1)
            filename = filename.strip()
            sharing_url = sharing_url.strip()
            dest = os.path.join(target_dir, filename)

            if os.path.exists(dest):
                print(f"  already exists: {filename}")
                continue

            print(f"  downloading: {filename} ...")
            direct_url = get_direct_url(sharing_url)
            if not direct_url:
                print(f"  could not parse GDrive URL for {filename}")
                continue

            ok = download_file(direct_url, dest)
            if ok:
                print(f"  saved: {dest}")
            else:
                print(f"  FAILED: {filename}")


if __name__ == "__main__":
    import sys
    props = sys.argv[1] if len(sys.argv) > 1 else "binaries.properties"
    dest  = sys.argv[2] if len(sys.argv) > 2 else "."
    download_if_missing(props, dest)
