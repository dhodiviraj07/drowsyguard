# DrowsyGuard + Emergency

**Real-time Driver Drowsiness Detection & Automated Emergency Dispatch System**

DrowsyGuard is an intelligent computer-vision safety system that runs directly in the browser to detect driver fatigue, eye blinks, yawning, and head nodding in real time using MediaPipe Face Mesh. If an alert goes unacknowledged or a collision is detected, the system automatically dispatches emergency SMS and Email alerts with live GPS coordinates, reverse-geocoded address, and the nearest hospital & police station information.

---

## 🌟 Key Features

- **Real-Time Facial Landmark Tracking:**
  - **Eye Aspect Ratio (EAR):** Tracks eye closure duration to differentiate normal blinks from microsleep / drowsiness.
  - **Mouth Aspect Ratio (MAR):** Detects yawning frequency.
  - **PERCLOS:** Calculates the percentage of eye closure over a 60-second sliding window.
  - **Head Nod Detection:** Monitors head pitch angle to catch head dropping from fatigue.
- **Audio & Visual Warning System:**
  - Level-1 warning sirens and voice alerts ("Wake up! Stay alert.").
  - Escalated Level-2 warning sirens if eye closure persists > 2 seconds.
- **Automated Emergency Dispatch:**
  - **Automated SMS:** Dispatches emergency text messages with GPS coordinates and nearest hospital info via Twilio, Fast2SMS, or smart simulator.
  - **Automated Email:** Forwards rich HTML emergency reports to configured contacts via Gmail, custom SMTP, or preview mailer.
  - **Auto-Triggering:** Automatically activates if a Level-2 alarm remains unanswered for 8 seconds, on accelerometer crash detection, or via the manual SOS button.
- **Emergency Facility Lookup:**
  - Automatically queries OpenStreetMap to locate the nearest hospital and police station with direct navigation links.

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18 or higher)
- A modern web browser with webcam access (Chrome, Edge, Firefox, Brave)

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/dhodiviraj07/drowsyguard.git
cd drowsyguard
npm install
```

### 3. Running the Application
Start the local server:
```bash
node server.js
```
Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## ⚙️ Configuration

Click the **Emergency** button in the top navigation bar to configure:
- **Driver Details:** Name, blood group, medical notes.
- **Emergency Contacts:** Name, phone numbers (for auto-SMS), and email addresses (for auto-Email).
- **Email Forwarding:** Gmail (Google App Password) or custom SMTP.
- **SMS Messaging:** Twilio, Fast2SMS, or Smart Simulator.

---

## 📄 License
MIT License.
