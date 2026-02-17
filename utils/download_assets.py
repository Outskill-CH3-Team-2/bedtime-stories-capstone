import os
import re
import requests

def get_direct_url(sharing_url):
    """Converts a standard GDrive sharing link to a direct download link."""
    file_id_match = re.search(r'/d/([a-zA-Z0-9_-]+)', sharing_url)
    if not file_id_match:
        return None
    file_id = file_id_match.group(1)
    return f"https://docs.google.com/uc?export=download&id={file_id}"

def download_if_missing(properties_path, target_dir):
    """Reads properties and downloads any files not present on disk."""
    if not os.path.exists(target_dir):
        os.makedirs(target_dir)

    with open(properties_path, 'r') as f:
        for line in f:
            if '=' not in line: continue
            filename, sharing_url = line.strip().split('=', 1)
            filepath = os.path.join(target_dir, filename)

            # Check if file exists before downloading
            if not os.path.exists(filepath):
                print(f"📥 Downloading missing asset: {filename}...")
                direct_url = get_direct_url(sharing_url)
                
                response = requests.get(direct_url, stream=True)
                if response.status_code == 200:
                    with open(filepath, 'wb') as out_file:
                        for chunk in response.iter_content(chunk_size=8192):
                            out_file.write(chunk)
                    print(f"✅ Successfully saved {filename}")
                else:
                    print(f"❌ Failed to download {filename} (Status: {response.status_code})")
            else:
                print(f"✔️ Asset already exists: {filename}")

if __name__ == "__main__":
    # Example usage targeting the frontend data folder
    download_if_missing("../binaries.properties", "../../frontend/data")