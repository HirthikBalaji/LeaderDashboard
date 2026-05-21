import os
import email
from email import policy
import json
import glob

def parse_emlx(file_path):
    with open(file_path, 'rb') as f:
        # First line is the length of the email part
        first_line = f.readline().strip()
        try:
            email_length = int(first_line)
        except ValueError:
            # Handle cases where it's not a standard emlx or first line is missing
            f.seek(0)
            email_length = -1
        
        if email_length != -1:
            email_data = f.read(email_length)
        else:
            email_data = f.read()
            
    msg = email.message_from_bytes(email_data, policy=policy.default)
    
    # Extract basic info
    res = {
        "subject": msg['subject'],
        "from": msg['from'],
        "to": msg['to'],
        "cc": msg['cc'],
        "date": msg['date'],
        "message_id": msg['message-id'],
        "file_path": file_path
    }
    
    # Extract body
    body = ""
    html_body = ""
    
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition"))
            
            if "attachment" not in content_disposition:
                if content_type == "text/plain":
                    payload = part.get_payload(decode=True)
                    if payload:
                        body += payload.decode(errors='ignore')
                elif content_type == "text/html":
                    payload = part.get_payload(decode=True)
                    if payload:
                        html_body += payload.decode(errors='ignore')
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode(errors='ignore')
    
    res["body"] = body.strip()
    res["html_body"] = html_body.strip()
    
    return res

def main():
    workspace_root = "/Users/hirthikbalaji/Desktop/FreshMail"
    mbox_dir = os.path.join(workspace_root, "inbox.mbox")
    output_file = os.path.join(workspace_root, "emails.json")
    
    if not os.path.exists(mbox_dir):
        print(f"Error: {mbox_dir} not found.")
        return

    # Find all .emlx files recursively
    emlx_files = []

    for root, dirs, files in os.walk(mbox_dir):
        for file in files:
            if file.endswith(".emlx"):
                emlx_files.append(os.path.join(root, file))

    print("Found:", len(emlx_files))

    print(f"Found {len(emlx_files)} emails. Processing...")
    
    emails = []
    for i, emlx_path in enumerate(emlx_files):
        try:
            email_info = parse_emlx(emlx_path)
            emails.append(email_info)
            if (i + 1) % 100 == 0:
                print(f"Processed {i + 1}/{len(emlx_files)}...")
        except Exception as e:
            print(f"Error parsing {emlx_path}: {e}")
            
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(emails, f, indent=4, ensure_ascii=False)
        
    print(f"Successfully saved {len(emails)} emails to {output_file}")

if __name__ == "__main__":
    main()
