import requests
import json
# Load emails from JSON file
with open("/Users/hirthikbalaji/Desktop/FreshMail/emails.json", "r") as f:
    emails_data = json.load(f)

url = "http://localhost:3000/api/load_emails"

payload = {
    "emails": emails_data,
    "reset": False
}



response = requests.post(url, json=payload)

print(response.status_code)
print(response.text)