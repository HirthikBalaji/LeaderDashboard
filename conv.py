import sys
import json
import zipfile
from lxml import etree
from datetime import datetime


def load_attachment(zip_file, name):
    return zip_file.open(name)


def get_id(email_node):
    tag_id = email_node.find('.//OPFMessageCopyMessageID')

    if tag_id is None:
        tag_id = email_node.find('.//OPFMessageCopyExchangeConversationId')

    if tag_id is not None and tag_id.text:
        return tag_id.text.strip()

    return None


def get_date(email_node):
    tag = email_node.find('.//OPFMessageCopySentTime')

    if tag is None:
        tag = email_node.find('.//OPFMessageCopyReceivedTime')

    if tag is None or not tag.text:
        return None

    try:
        date = datetime.strptime(
            tag.text.strip(),
            '%Y-%m-%dT%H:%M:%S'
        )
        return date.isoformat()

    except Exception:
        return None


from bs4 import BeautifulSoup


def html_to_text(html):
    soup = BeautifulSoup(html, 'html.parser')

    # remove script/style tags
    for tag in soup(['script', 'style']):
        tag.decompose()

    text = soup.get_text(separator='\n')

    # clean empty lines
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]

    return '\n'.join(lines)


def get_body(email_node):

    has_html = email_node.find('.//OPFMessageGetHasHTML')

    # Default plain text body
    tag_body = email_node.find('.//OPFMessageCopyBody')

    body = None

    # If HTML exists, prefer it
    if has_html is not None and has_html.text:

        html_flag = has_html.text.replace('E0', '')

        if html_flag == '1':

            html_body = email_node.find(
                './/OPFMessageCopyHTMLBody'
            )

            if (
                html_body is not None and
                html_body.text
            ):

                try:
                    body = html_to_text(
                        html_body.text
                    )

                except Exception:
                    body = html_body.text

    # fallback to plain text body
    if body is None and tag_body is not None:

        if tag_body.text:
            body = tag_body.text.strip()

    return body


def get_attachments(zip_file, email_node):
    attachments = []

    tag_attachments = email_node.find('.//OPFMessageCopyAttachmentList')

    if tag_attachments is not None:

        for attachment in tag_attachments.findall('.//messageAttachment'):

            name = attachment.get('OPFAttachmentName')
            mime_type = attachment.get('OPFAttachmentContentType')
            url = attachment.get('OPFAttachmentURL')

            attachments.append({
                'file_name': name,
                'mime_type': mime_type,
                'file_path': url
            })

    return attachments


def get_contacts(addresses):
    names = []
    emails = []

    if addresses is not None:

        for address in addresses.findall('.//emailAddress'):

            email_addr = address.get(
                'OPFContactEmailAddressAddress'
            )

            if email_addr:
                emails.append(email_addr)

            name = address.get(
                'OPFContactEmailAddressName'
            )

            if name and name != email_addr:
                names.append(name)

    return names, emails


def get_addresses(email_node):
    tag_from = email_node.find('.//OPFMessageCopyFromAddresses')
    tag_sender = email_node.find('.//OPFMessageCopySenderAddress')
    tag_to = email_node.find('.//OPFMessageCopyToAddresses')
    tag_cc = email_node.find('.//OPFMessageCopyCCAddresses')
    tag_bcc = email_node.find('.//OPFMessageCopyBCCAddresses')

    from_names, from_emails = get_contacts(tag_from)
    sender_names, sender_emails = get_contacts(tag_sender)
    to_names, to_emails = get_contacts(tag_to)
    cc_names, cc_emails = get_contacts(tag_cc)
    bcc_names, bcc_emails = get_contacts(tag_bcc)

    names = (
        to_names +
        from_names +
        cc_names +
        bcc_names +
        sender_names
    )

    emails = (
        to_emails +
        from_emails +
        cc_emails +
        bcc_emails +
        sender_emails
    )

    frm = from_emails + sender_emails
    author = from_names + sender_names

    return {
        'names': names,
        'emails': emails,
        'author': author,
        'from': frm,
        'to': to_emails,
        'cc': cc_emails,
        'bcc': bcc_emails
    }


def parse_message(zip_file, name):

    fh = zip_file.open(name)

    doc = None

    try:
        doc = etree.parse(fh)

    except etree.XMLSyntaxError:

        fh.seek(0)

        parser = etree.XMLParser(
            huge_tree=True,
            recover=True
        )

        try:
            doc = etree.parse(fh, parser)

        except etree.XMLSyntaxError:
            return None

    if doc is None:
        return None

    for email_node in doc.findall('.//email'):

        addresses = get_addresses(email_node)

        tag_subject = email_node.find(
            './/OPFMessageCopySubject'
        )

        subject = None

        if tag_subject is not None and tag_subject.text:
            subject = tag_subject.text.strip()

        return {
            'message_id': get_id(email_node),
            'date': get_date(email_node),
            'subject': subject,
            'body': get_body(email_node),
            'attachments': get_attachments(
                zip_file,
                email_node
            ),
            'from': addresses['from'],
            'to': addresses['to'],
            'cc': addresses['cc'],
            'bcc': addresses['bcc'],
            'author': addresses['author'],
            'names': addresses['names'],
            'emails': addresses['emails']
        }

    return None


def main():

    if len(sys.argv) < 2:
        print("Usage: python script.py <file.olm>")
        sys.exit(1)

    olm_file = sys.argv[1]

    all_emails = []

    with zipfile.ZipFile(olm_file, 'r') as zf:

        for info in zf.namelist():

            if 'com.microsoft.__Attachments' in info:
                continue

            if 'message_' not in info:
                continue

            parsed = parse_message(zf, info)

            if parsed:
                all_emails.append(parsed)

    output_file = 'emails.json'

    with open(output_file, 'w', encoding='utf-8') as f:

        json.dump(
            all_emails,
            f,
            indent=2,
            ensure_ascii=False
        )

    print(f"Saved {len(all_emails)} emails to {output_file}")


if __name__ == '__main__':
    main()
