from flask import Flask, render_template, send_from_directory, request, jsonify
import os
import pandas as pd
import cv2
import face_recognition
import numpy as np
import base64
from datetime import datetime
import qrcode
from PIL import Image
import io

# --- INITIALIZATION & USER AUTH (No Changes) ---
app = Flask(__name__)
KNOWN_FACES_DIR = 'known_faces'
QR_CODES_DIR = 'qrcodes'
ATTENDANCE_FILE = 'attendance_records.xlsx'
USERS_FILE = 'users.xlsx'
for dir_path in [KNOWN_FACES_DIR, QR_CODES_DIR]:
    if not os.path.exists(dir_path): os.makedirs(dir_path)
def get_users_df():
    required_columns = ['Username', 'Password']
    try:
        df = pd.read_excel(USERS_FILE)
        if list(df.columns) != required_columns: raise FileNotFoundError
    except FileNotFoundError:
        df = pd.DataFrame(columns=required_columns)
        df.to_excel(USERS_FILE, index=False)
    return df
@app.route('/register', methods=['POST'])
def register_user():
    data = request.json
    username, password = data.get('username'), data.get('password')
    df = get_users_df()
    if username in df['Username'].values: return jsonify({'status': 'error', 'message': 'Username already exists.'}), 409
    new_user = pd.DataFrame([{'Username': username, 'Password': str(password)}])
    df = pd.concat([df, new_user], ignore_index=True)
    df.to_excel(USERS_FILE, index=False)
    return jsonify({'status': 'success', 'message': 'Registration successful! Please login.'})
@app.route('/login', methods=['POST'])
def login_user():
    data = request.json
    username, password = data.get('username'), data.get('password')
    df = get_users_df()
    if df.empty: return jsonify({'status': 'error', 'message': 'Invalid credentials.'}), 401
    df['Password'] = df['Password'].astype(str)
    user = df[(df['Username'] == username) & (df['Password'] == str(password))]
    if not user.empty: return jsonify({'status': 'success', 'message': 'Login successful!'})
    else: return jsonify({'status': 'error', 'message': 'Invalid credentials.'}), 401

# --- ATTENDANCE LOGGING & QR SCAN (No Changes) ---
def log_attendance_to_excel(student_id, source="Face Recognition"):
    student_name = student_id
    today_str = datetime.now().strftime("%Y-%m-%d")
    timestamp = datetime.now().strftime("%H:%M:%S")
    try:
        df = pd.read_excel(ATTENDANCE_FILE)
    except FileNotFoundError:
        df = pd.DataFrame(columns=['ID', 'Name', 'Date', 'Status', 'Timestamp', 'Source'])
    existing_entry = df[(df['ID'] == student_id) & (df['Date'] == today_str)]
    if existing_entry.empty:
        new_record = pd.DataFrame([{'ID': student_id, 'Name': student_name, 'Date': today_str, 'Status': 'Present', 'Timestamp': timestamp, 'Source': source}])
        df = pd.concat([df, new_record], ignore_index=True)
        print(f"✅ Logged new attendance for {student_name} via {source}.")
    else:
        print(f"ℹ️ {student_name} already marked present today.")
    df.to_excel(ATTENDANCE_FILE, index=False)
@app.route('/qr_scan', methods=['POST'])
def handle_qr_scan():
    data = request.json
    student_id = data.get('studentId')
    if not student_id: return jsonify({'status': 'error', 'message': 'Invalid QR data.'}), 400
    _, known_names = load_known_faces()
    if student_id not in known_names: return jsonify({'status': 'error', 'message': f'Student {student_id} not enrolled.'}), 404
    log_attendance_to_excel(student_id, source="QR Scan")
    return jsonify({'status': 'success', 'message': f'Attendance marked for {student_id}!'})

# --- NEW PROFESSIONAL ANALYTICS ENDPOINT ---
@app.route('/analytics', methods=['GET'])
def get_analytics():
    try:
        df = pd.read_excel(ATTENDANCE_FILE)
    except FileNotFoundError:
        # Return a default empty structure if no attendance file exists
        return jsonify({
            'allStudents': [], 'summary': {}, 'byDate': [], 
            'byStudent': [], 'bySource': [], 'details': []
        })

    if df.empty:
        return jsonify({
            'allStudents': [], 'summary': {}, 'byDate': [], 
            'byStudent': [], 'bySource': [], 'details': []
        })

    # Get a list of all unique students for the filter dropdown
    all_students = df['Name'].unique().tolist()
    
    # --- Apply Filters ---
    student_filter = request.args.get('student')
    start_date_filter = request.args.get('start_date')
    end_date_filter = request.args.get('end_date')

    if student_filter:
        df = df[df['Name'] == student_filter]
    if start_date_filter:
        df = df[df['Date'] >= start_date_filter]
    if end_date_filter:
        df = df[df['Date'] <= end_date_filter]

    if df.empty: # After filtering, data might be empty
        return jsonify({
            'allStudents': all_students, 'summary': {'totalStudents': 0, 'totalDays': 0, 'totalRecords': 0}, 
            'byDate': [], 'byStudent': [], 'bySource': [], 'details': []
        })

    # --- Calculations on Filtered Data ---
    total_students_in_filter = df['ID'].nunique()
    total_days_in_filter = df['Date'].nunique()
    total_records_in_filter = len(df)
    
    # Busiest Day
    busiest_day = df['Date'].mode()[0] if not df['Date'].mode().empty else 'N/A'

    # By Date (Line Chart)
    by_date = df.groupby('Date').size().reset_index(name='count').to_dict('records')
    
    # By Student (Bar Chart)
    by_student = df.groupby('Name')['Date'].nunique().reset_index()
    by_student.rename(columns={'Date': 'DaysAttended'}, inplace=True)
    if total_days_in_filter > 0:
        by_student['Percentage'] = round((by_student['DaysAttended'] / total_days_in_filter) * 100, 2)
    else:
        by_student['Percentage'] = 0
    
    # By Source (Pie Chart)
    by_source = df.groupby('Source').size().reset_index(name='count').to_dict('records')

    return jsonify({
        'allStudents': all_students,
        'summary': {
            'totalStudents': total_students_in_filter, 
            'totalDays': total_days_in_filter, 
            'totalRecords': total_records_in_filter,
            'busiestDay': busiest_day
        },
        'byDate': by_date,
        'byStudent': by_student.to_dict('records'),
        'bySource': by_source,
        'details': df.to_dict('records')
    })

@app.route('/sync-attendance', methods=['POST'])
def sync_offline_attendance():
    """Sync offline attendance records when device comes back online"""
    try:
        data = request.json
        if not data or not isinstance(data, list):
            return jsonify({'status': 'error', 'message': 'Invalid data format'}), 400
        
        synced_count = 0
        for record in data:
            # Validate record structure
            required_fields = ['ID', 'Name', 'Date', 'Status', 'Timestamp', 'Source']
            if not all(field in record for field in required_fields):
                continue
                
            # Check if record already exists (avoid duplicates)
            try:
                df = pd.read_excel(ATTENDANCE_FILE)
                existing = df[(df['ID'] == record['ID']) & (df['Date'] == record['Date'])]
                if existing.empty:
                    # Add the offline record
                    new_record = pd.DataFrame([{
                        'ID': record['ID'],
                        'Name': record['Name'],
                        'Date': record['Date'],
                        'Status': record['Status'],
                        'Timestamp': record['Timestamp'],
                        'Source': f"{record['Source']} (Synced)"
                    }])
                    df = pd.concat([df, new_record], ignore_index=True)
                    df.to_excel(ATTENDANCE_FILE, index=False)
                    synced_count += 1
            except FileNotFoundError:
                # Create new file if it doesn't exist
                df = pd.DataFrame([{
                    'ID': record['ID'],
                    'Name': record['Name'],
                    'Date': record['Date'],
                    'Status': record['Status'],
                    'Timestamp': record['Timestamp'],
                    'Source': f"{record['Source']} (Synced)"
                }])
                df.to_excel(ATTENDANCE_FILE, index=False)
                synced_count += 1
        
        return jsonify({
            'status': 'success',
            'message': f'Successfully synced {synced_count} attendance records',
            'synced_count': synced_count
        })
        
    except Exception as e:
        print(f"Sync error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Failed to sync attendance records'
        }), 500
    



@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)

@app.route('/manifest.json')
def serve_manifest():
    response = send_from_directory('static', 'manifest.json')
    response.headers['Content-Type'] = 'application/manifest+json'
    return response

@app.route('/sw.js')
def serve_sw():
    response = send_from_directory('static', 'sw.js')
    response.headers['Service-Worker-Allowed'] = '/'
    response.headers['Content-Type'] = 'application/javascript'
    response.headers['Cache-Control'] = 'no-cache'
    return response

# --- FACE RECOGNITION, ENROLLMENT, ETC. (No Changes) ---
def load_known_faces():
    known_face_encodings, known_face_names = [], []
    for filename in os.listdir(KNOWN_FACES_DIR):
        if filename.endswith((".jpg", ".png")):
            image = face_recognition.load_image_file(os.path.join(KNOWN_FACES_DIR, filename))
            encodings = face_recognition.face_encodings(image)
            if encodings:
                known_face_encodings.append(encodings[0])
                known_face_names.append(os.path.splitext(filename)[0])
    return known_face_encodings, known_face_names
@app.route('/enroll', methods=['POST'])
def enroll_student():
    data = request.json
    student_id = data.get('studentId')
    image_data_url = data.get('imageDataURL')
    if not student_id or not image_data_url: return jsonify({'status': 'error', 'message': 'Missing data.'}), 400
    header, encoded = image_data_url.split(",", 1)
    binary_data = base64.b64decode(encoded)
    filepath = os.path.join(KNOWN_FACES_DIR, f"{student_id}.jpg")
    with open(filepath, 'wb') as f: f.write(binary_data)
    print(f"📸 Photo saved for {student_id}!")
    qr_img = qrcode.make(student_id)
    qr_filepath = os.path.join(QR_CODES_DIR, f"{student_id}.png")
    qr_img.save(qr_filepath)
    print(f"🚀 QR Code saved for {student_id}!")
    buffered = io.BytesIO()
    qr_img.save(buffered, format="PNG")
    qr_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
    return jsonify({'status': 'success', 'message': f'Student {student_id} enrolled successfully!', 'qrCode': f'data:image/png;base64,{qr_base64}'})
def process_image_for_recognition(image_data_url):
    header, encoded = image_data_url.split(",", 1)
    binary_data = base64.b64decode(encoded)
    nparr = np.frombuffer(binary_data, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    known_encodings, known_names = load_known_faces()
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    face_locations = face_recognition.face_locations(rgb_frame)
    face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)
    recognized_faces = []
    for (top, right, bottom, left), face_encoding in zip(face_locations, face_encodings):
        name = "Unknown"
        if known_names:
            matches = face_recognition.compare_faces(known_encodings, face_encoding, tolerance=0.6)
            if True in matches: name = known_names[matches.index(True)]
        recognized_faces.append({"name": name, "location": [top, right, bottom, left]})
    return recognized_faces
@app.route('/recognize', methods=['POST'])
def recognize_and_log():
    image_data_url = request.json.get('imageDataURL')
    if not image_data_url: return jsonify([]), 400
    recognized_faces = process_image_for_recognition(image_data_url)
    for face in recognized_faces:
        if face["name"] != "Unknown": log_attendance_to_excel(face["name"])
    return jsonify(recognized_faces)
@app.route('/')
def index(): return render_template('index.html')
@app.route('/records', methods=['GET'])
def get_records():
    try: return jsonify(pd.read_excel(ATTENDANCE_FILE).to_dict('records'))
    except FileNotFoundError: return jsonify([])
# In app.py, change the last line to:
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5500))
    app.run(host='0.0.0.0', port=port, debug=True)