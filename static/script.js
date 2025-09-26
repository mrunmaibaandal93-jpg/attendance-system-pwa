let videoStream = null;
let recognitionInterval = null;
let html5QrCode = null;
const charts = {};
let analyticsDataCache = null;
let isOnline = navigator.onLine;
let offlineNotificationShown = false;

const mainView = document.getElementById('mainView');

// Online/Offline status management
window.addEventListener('online', () => {
    isOnline = true;
    showOnlineStatus();
    syncOfflineData();
});

window.addEventListener('offline', () => {
    isOnline = false;
    showOfflineStatus();
});

function showOnlineStatus() {
    showNotification('Back online! Syncing data...', 'success');
    hideOfflineIndicator();
}

function showOfflineStatus() {
    showNotification('You are offline. Data will be saved locally and synced when reconnected.', 'warning');
    showOfflineIndicator();
}

function showOfflineIndicator() {
    let indicator = document.getElementById('offline-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'offline-indicator';
        indicator.innerHTML = '⚠️ Offline Mode';
        indicator.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #ff9800;
            color: white;
            text-align: center;
            padding: 8px;
            font-size: 14px;
            z-index: 2000;
        `;
        document.body.appendChild(indicator);
    }
}

function hideOfflineIndicator() {
    const indicator = document.getElementById('offline-indicator');
    if (indicator) {
        indicator.remove();
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: bold;
        z-index: 2001;
        max-width: 300px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        background: ${type === 'success' ? '#28a745' : type === 'warning' ? '#ff9800' : '#007BFF'};
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => notification.remove(), 5000);
}

// Enhanced page navigation with offline support
function showPage(pageId) {
    stopAllProcesses();
    const template = document.getElementById(`${pageId}-template`);
    if (template) {
        mainView.innerHTML = '';
        mainView.appendChild(template.content.cloneNode(true));
        mainView.style.display = (pageId === 'analyticsPage') ? 'block' : 'flex';
        
        // Add offline status indicator if needed
        if (!isOnline) {
            showOfflineIndicator();
        }
        
        if (pageId === 'liveAttendancePage') startLiveCamera();
        else if (pageId === 'qrScannerPage') startQrScanner();
        else if (pageId === 'analyticsPage') renderAnalytics();
        else if (pageId === 'attendanceRecord') renderAttendance();
    }
}

// Enhanced authentication with offline handling
async function register() {
    const username = document.getElementById('regName').value.trim();
    const password = document.getElementById('regPass').value;
    if (password !== document.getElementById('regCPass').value) {
        return alert("Passwords do not match!");
    }
    
    if (!isOnline) {
        alert("Registration requires internet connection. Please connect and try again.");
        return;
    }
    
    const response = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    }).catch(() => ({ ok: false, json: () => ({ message: "Connection failed" }) }));
    
    const result = await response.json();
    alert(result.message);
    if (response.ok) showPage('loginPage');
}

async function login() {
    const username = document.getElementById('loginName').value.trim();
    const password = document.getElementById('loginPass').value;
    
    if (!isOnline) {
        alert("Login requires internet connection. Please connect and try again.");
        return;
    }
    
    const response = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    }).catch(() => ({ ok: false, json: () => ({ message: "Connection failed" }) }));
    
    const result = await response.json();
    if (response.ok) {
        // Store login status for offline use
        localStorage.setItem('loggedIn', 'true');
        localStorage.setItem('username', username);
        showPage('dashboard');
    } else {
        alert(result.message);
    }
}

function logout() { 
    localStorage.removeItem('loggedIn');
    localStorage.removeItem('username');
    showPage('loginPage'); 
}

// Enhanced student enrollment with offline support
async function saveStudent() {
    const studentName = document.getElementById('stuName').value.trim();
    if (!studentName || studentName.includes(' ')) {
        return alert("Student name cannot have spaces.");
    }
    if (!videoStream) {
        return alert("Please start the camera first.");
    }
    
    const canvas = document.getElementById('canvas');
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataURL = canvas.toDataURL('image/jpeg');
    
    // Show loading state
    const saveBtn = document.querySelector('button[onclick="saveStudent()"]');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;
    
    try {
        const response = await fetch('/enroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId: studentName, imageDataURL }),
        });
        
        const result = await response.json();
        
        if (response.ok) {
            document.getElementById('qrModalTitle').textContent = 
                isOnline ? `Student ${studentName} Enrolled!` : `Student ${studentName} Enrolled Offline!`;
            document.getElementById('qrModalImage').src = result.qrCode;
            document.getElementById('qrModal').style.display = 'flex';
            
            if (!isOnline) {
                showNotification('Student enrolled offline. Will sync when online.', 'warning');
            }
        } else {
            alert(result.message);
        }
    } catch (error) {
        if (!isOnline) {
            showNotification('Enrollment saved offline. Will sync when online.', 'warning');
            // Create offline QR modal
            document.getElementById('qrModalTitle').textContent = `Student ${studentName} Enrolled Offline!`;
            document.getElementById('qrModalImage').src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2Y4ZjlmYSIvPjx0ZXh0IHg9IjEwMCIgeT0iMTAwIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+UVIgQ29kZTwvdGV4dD48L3N2Zz4=";
            document.getElementById('qrModal').style.display = 'flex';
        } else {
            alert('Failed to enroll student. Please try again.');
        }
    } finally {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
    }
}

// Enhanced live attendance with offline support
function startLiveCamera() {
    startCamera('live-webcam-container');
    recognitionInterval = setInterval(async () => {
        if (!videoStream) return;
        
        const canvas = document.getElementById('canvas');
        const overlayCanvas = document.getElementById('overlayCanvas');
        const overlayCtx = overlayCanvas.getContext('2d');
        const statusDiv = document.getElementById('recognition-status');
        
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageDataURL = canvas.toDataURL('image/jpeg');
        
        try {
            const response = await fetch('/recognize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageDataURL })
            });
            
            const recognizedFaces = await response.json();
            displayRecognitionResults(recognizedFaces, overlayCtx, statusDiv);
            
        } catch (error) {
            if (!isOnline) {
                statusDiv.textContent = "Offline mode - Limited recognition";
                statusDiv.style.color = "orange";
            } else {
                statusDiv.textContent = "Recognition failed";
                statusDiv.style.color = "red";
            }
        }
    }, 2000);
}

function displayRecognitionResults(recognizedFaces, overlayCtx, statusDiv) {
    overlayCtx.clearRect(0, 0, overlayCtx.canvas.width, overlayCtx.canvas.height);
    const knownNames = new Set();
    
    recognizedFaces.forEach(face => {
        const [top, right, bottom, left] = face.location;
        const isKnown = face.name !== "Unknown";
        overlayCtx.strokeStyle = isKnown ? 'lime' : 'red';
        overlayCtx.lineWidth = 3;
        overlayCtx.strokeRect(left, top, right - left, bottom - top);
        if (isKnown) knownNames.add(face.name);
    });
    
    if (knownNames.size > 0) {
        statusDiv.textContent = `Present: ${[...knownNames].join(', ')}${!isOnline ? ' (Offline)' : ''}`;
        statusDiv.style.color = isOnline ? "green" : "orange";
    } else {
        statusDiv.textContent = isOnline ? "Scanning..." : "Offline scanning...";
        statusDiv.style.color = "#333";
    }
}

// Enhanced QR scanning with offline support
function startQrScanner() {
    try {
        html5QrCode = new Html5Qrcode("qr-reader");
        const successCallback = async (decodedText) => {
            if (html5QrCode && html5QrCode.isScanning) html5QrCode.stop();
            const resultDiv = document.getElementById('qr-scan-result');
            resultDiv.textContent = `Scanned ${decodedText}. Verifying...`;
            
            try {
                const response = await fetch('/qr_scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ studentId: decodedText })
                });
                
                const result = await response.json();
                resultDiv.style.color = response.ok ? 'green' : 'red';
                resultDiv.textContent = result.message + (isOnline ? '' : ' (Offline)');
                
            } catch (error) {
                if (!isOnline) {
                    resultDiv.style.color = 'orange';
                    resultDiv.textContent = `Offline attendance marked for ${decodedText}`;
                } else {
                    resultDiv.style.color = 'red';
                    resultDiv.textContent = 'QR scan failed';
                }
            }
        };
        html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, successCallback);
    } catch (e) {
        alert("QR Scanner failed to start.");
    }
}

// Enhanced analytics with offline support
async function renderAnalytics(filters = {}) {
    try {
        const query = new URLSearchParams(filters).toString();
        const response = await fetch(`/analytics?${query}`);
        const data = await response.json();
        analyticsDataCache = data;
        
        if (!isOnline) {
            showNotification('Showing cached analytics data', 'warning');
        }
        
        renderAnalyticsCharts(data);
        
    } catch (error) {
        if (!isOnline) {
            showNotification('Loading offline analytics data', 'warning');
            // Load from service worker cache
            const data = await getOfflineAnalytics();
            analyticsDataCache = data;
            renderAnalyticsCharts(data);
        } else {
            alert('Failed to load analytics data');
        }
    }
}

function renderAnalyticsCharts(data) {
    // Populate student filter
    const studentFilter = document.getElementById('studentFilter');
    if (studentFilter && studentFilter.options.length <= 1) {
        data.allStudents.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            studentFilter.appendChild(option);
        });
    }
    
    // Update KPI cards
    document.getElementById('totalStudents').textContent = data.summary.totalStudents || 0;
    document.getElementById('totalRecords').textContent = data.summary.totalRecords || 0;
    document.getElementById('busiestDay').textContent = data.summary.busiestDay || 'N/A';
    
    // Destroy old charts
    Object.values(charts).forEach(chart => chart && chart.destroy());
    
    // Create new charts
    try {
        charts.dateChart = new Chart(document.getElementById('dateChart').getContext('2d'), {
            type: 'line',
            data: {
                labels: data.byDate.map(d => d.Date),
                datasets: [{ label: 'Students Present', data: data.byDate.map(d => d.count), borderColor: '#007BFF', tension: 0.1 }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
        
        charts.studentChart = new Chart(document.getElementById('studentChart').getContext('2d'), {
            type: 'bar',
            data: {
                labels: data.byStudent.map(s => s.Name),
                datasets: [{ label: 'Attendance %', data: data.byStudent.map(s => s.Percentage), backgroundColor: '#17a2b8' }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } }
        });
        
        charts.sourceChart = new Chart(document.getElementById('sourceChart').getContext('2d'), {
            type: 'pie',
            data: {
                labels: data.bySource.map(s => s.Source),
                datasets: [{ label: 'by Source', data: data.bySource.map(s => s.count), backgroundColor: ['#28a745', '#ffc107'] }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    } catch (error) {
        console.error('Chart rendering error:', error);
    }
    
    // Populate details table
    const detailsTable = document.querySelector('#detailsTable tbody');
    if (detailsTable) {
        detailsTable.innerHTML = '';
        data.details.forEach(rec => {
            const row = document.createElement('tr');
            if (rec.Offline) row.style.backgroundColor = '#fff3cd'; // Highlight offline records
            row.innerHTML = `<td>${rec.ID}</td><td>${rec.Name}</td><td>${rec.Date}</td><td>${rec.Timestamp}</td><td>${rec.Source}${rec.Offline ? ' (Offline)' : ''}</td>`;
            detailsTable.appendChild(row);
        });
    }
}

// Enhanced attendance records with offline support
async function renderAttendance() {
    try {
        const response = await fetch('/records');
        const records = await response.json();
        populateAttendanceTable(records);
    } catch (error) {
        if (!isOnline) {
            showNotification('Loading offline attendance records', 'warning');
            const offlineRecords = await getOfflineAttendanceRecords();
            populateAttendanceTable(offlineRecords);
        } else {
            alert('Failed to load attendance records');
        }
    }
}

function populateAttendanceTable(records) {
    const tbody = document.getElementById('attendanceTable');
    if (tbody) {
        tbody.innerHTML = "";
        records.forEach(rec => {
            const row = document.createElement('tr');
            if (rec.Offline) row.style.backgroundColor = '#fff3cd';
            row.innerHTML = `
                <td>${rec.ID}</td>
                <td>${rec.Name}</td>
                <td>${rec.Date}</td>
                <td><span class="status-present">${rec.Status}</span></td>
                <td>${rec.Timestamp}</td>
                <td>${rec.Source || 'N/A'}${rec.Offline ? ' (Offline)' : ''}</td>
            `;
            tbody.appendChild(row);
        });
    }
}

// Offline data management functions
async function getOfflineAnalytics() {
    if ('caches' in window) {
        const cache = await caches.open('attendance-offline-v1');
        const response = await cache.match('/analytics-offline');
        if (response) {
            return await response.json();
        }
    }
    
    // Return default empty analytics
    return {
        allStudents: [],
        summary: { totalStudents: 0, totalDays: 0, totalRecords: 0, busiestDay: 'N/A' },
        byDate: [],
        byStudent: [],
        bySource: [],
        details: []
    };
}

async function getOfflineAttendanceRecords() {
    if ('caches' in window) {
        const cache = await caches.open('attendance-offline-v1');
        const response = await cache.match('/attendance-records');
        if (response) {
            return await response.json();
        }
    }
    return [];
}

// Sync offline data when back online
async function syncOfflineData() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        try {
            await navigator.serviceWorker.ready;
            if ('sync' in window.ServiceWorkerRegistration.prototype) {
                const registration = await navigator.serviceWorker.ready;
                await registration.sync.register('sync-attendance');
                showNotification('Syncing offline data...', 'info');
            } else {
                // Fallback sync for browsers without background sync
                await manualSync();
            }
        } catch (error) {
            console.error('Sync registration failed:', error);
        }
    }
}

async function manualSync() {
    // Manual sync implementation for browsers without background sync support
    const cache = await caches.open('attendance-offline-v1');
    
    // Try to sync attendance records
    const attendanceResponse = await cache.match('/attendance-records');
    if (attendanceResponse) {
        const records = await attendanceResponse.json();
        const offlineRecords = records.filter(r => r.Offline);
        
        if (offlineRecords.length > 0) {
            try {
                const response = await fetch('/sync-attendance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(offlineRecords)
                });
                
                if (response.ok) {
                    showNotification('Offline data synced successfully!', 'success');
                    // Update cache to remove offline flags
                    const updatedRecords = records.map(r => ({ ...r, Offline: false }));
                    await cache.put('/attendance-records', new Response(JSON.stringify(updatedRecords)));
                }
            } catch (error) {
                console.error('Manual sync failed:', error);
            }
        }
    }
}

// Enhanced filter and export functions
function applyAnalyticsFilters() {
    const filters = {
        student: document.getElementById('studentFilter')?.value || '',
        start_date: document.getElementById('startDate')?.value || '',
        end_date: document.getElementById('endDate')?.value || ''
    };
    Object.keys(filters).forEach(key => filters[key] === '' && delete filters[key]);
    renderAnalytics(filters);
}

function resetAnalyticsFilters() {
    const studentFilter = document.getElementById('studentFilter');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    
    if (studentFilter) studentFilter.value = '';
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    
    renderAnalytics();
}

function exportAnalyticsToCSV() {
    if (!analyticsDataCache || analyticsDataCache.details.length === 0) {
        alert("No data to export.");
        return;
    }
    
    const headers = "ID,Name,Date,Timestamp,Source,Status\n";
    const rows = analyticsDataCache.details.map(rec => 
        `${rec.ID},${rec.Name},${rec.Date},${rec.Timestamp},${rec.Source}${rec.Offline ? ' (Offline)' : ''},${rec.Status}`
    ).join("\n");
    
    const csvContent = "data:text/csv;charset=utf-8," + headers + rows;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `attendance_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    
    showNotification('Attendance report exported successfully!', 'success');
}

// Camera and QR controls (keep existing functions)
async function startCamera(containerId) {
    if (videoStream) return;
    const container = document.getElementById(containerId);
    const video = document.getElementById('video');
    const overlayCanvas = document.getElementById('overlayCanvas');
    if (!container || !video || !overlayCanvas) { 
        console.error("Camera elements not found!"); 
        return; 
    }
    container.appendChild(video); 
    container.appendChild(overlayCanvas);
    video.style.display = 'block'; 
    overlayCanvas.style.display = 'block';
    try {
        videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = videoStream;
    } catch (err) { 
        alert("Could not access webcam. Please check permissions."); 
    }
}

function stopCamera() {
    const video = document.getElementById('video');
    const overlayCanvas = document.getElementById('overlayCanvas');
    if (!video || !overlayCanvas) return;
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    if (recognitionInterval) {
        clearInterval(recognitionInterval);
        recognitionInterval = null;
    }
    video.style.display = 'none';
    overlayCanvas.style.display = 'none';
    overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    document.body.appendChild(video);
    document.body.appendChild(overlayCanvas);
}

function stopQrScanner() {
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(err => console.warn("QR scanner stop error:", err));
    }
    html5QrCode = null;
}

function stopAllProcesses() {
    stopCamera();
    stopQrScanner();
}

function startEnrollmentCamera() { 
    startCamera('webcam-container'); 
}

function closeQrModal() {
    document.getElementById('qrModal').style.display = 'none';
    stopCamera();
    showPage('dashboard');
}

// Enhanced service worker registration with offline support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/static/sw.js')
            .then(registration => {
                console.log('SW registered:', registration);
                
                // Listen for updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            showNotification('App updated! Refresh to use the latest version.', 'info');
                        }
                    });
                });
            })
            .catch(error => console.log('SW registration failed:', error));
    });
    
    // Handle messages from service worker
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data.type === 'SYNC_COMPLETE') {
            showNotification('Offline data synced successfully!', 'success');
        }
    });
}

// PWA Install Prompt Enhancement
let deferredPrompt;
const installBtn = document.getElementById('installBtn');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.style.display = 'block';
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                installBtn.style.display = 'none';
                showNotification('App installed successfully!', 'success');
            }
            deferredPrompt = null;
        }
    });
}

window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.style.display = 'none';
    showNotification('Attendance app installed! You can now use it offline.', 'success');
});

// Auto-login from localStorage for offline use
window.addEventListener('load', () => {
    if (localStorage.getItem('loggedIn') === 'true') {
        showPage('dashboard');
    } else {
        showPage('createAccount');
    }
    
    // Show offline indicator if starting offline
    if (!isOnline) {
        showOfflineIndicator();
    }
});

// Initial load
if (localStorage.getItem('loggedIn') !== 'true') {
    showPage('createAccount');
}