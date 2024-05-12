const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');
const session = require('express-session');
const Chart = require('chart.js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Firebase Admin SDK Initialization
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://healthcare-zero1-default-rtdb.firebaseio.com/' // Update with your Firebase database URL
});
const db = admin.database();
const usersRef = db.ref('users');

// Middleware
app.use(cors({
     origin: true,
  credentials: true
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Add session middleware
app.use(session({
    secret: 'your_secret_key', 
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true } 
}));


// Registration Endpoint with Password Hashing
app.post('/api/auth/register', async (req, res) => {
    const { patientId, password, email } = req.body;
    try {
        const userSnapshot = await usersRef.child(patientId).once('value');
        if (userSnapshot.exists()) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await usersRef.child(patientId).set({ email, password: hashedPassword, patientId, appointments: [] });
        req.session.user = { patientId, email }; // Save user data in session
        res.json({ success: true, message: 'User registered successfully', userData: req.session.user });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Login Endpoint with Password Hashing
app.post('/api/auth/login', async (req, res) => {
    const { patientId, password } = req.body;
    try {
        const userSnapshot = await usersRef.child(patientId).once('value');
        const userData = userSnapshot.val();

        // Check if user data exists
        if (!userData) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if password property exists in user data
        if (!userData.password) {
            return res.status(400).json({ error: 'User data incomplete' });
        }

        const isPasswordValid = await bcrypt.compare(password, userData.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        // Set user data in session
        req.session.user = { patientId, email: userData.email };
        res.json({ success: true, message: 'Login successful', userData: req.session.user });
    } catch (error) {
        console.error('Error logging in user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to Book Appointments with Scheduling Conflicts Detection
app.post('/api/appointments/book', async (req, res) => {
    const { name, age, email, hospital, appointmentDateTime } = req.body;
    const newAppointment = {
        id: Date.now().toString(), // Generate a unique ID for the appointment
        name,
        age,
        email,
        hospital,
        appointmentDateTime,
    };

    try {
        // Check if user is authenticated and session contains user data
        if (!req.session || !req.session.user || !req.session.user.patientId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Check for scheduling conflicts
        const existingAppointments = await usersRef
            .child(req.session.user.patientId)
            .child('appointments')
            .once('value');

        let hasConflict = false;
        existingAppointments.forEach((childSnapshot) => {
            const existingAppointment = childSnapshot.val();
            if (checkConflict(existingAppointment.appointmentDateTime, appointmentDateTime)) {
                hasConflict = true;
            }
        });

        if (hasConflict) {
            // Scheduling conflict detected, inform the user
            res.status(409).json({ error: 'Scheduling conflict detected. Please choose another time slot.' });
        } else {
            // No conflict, proceed with booking the appointment
            await usersRef.child(req.session.user.patientId).child('appointments').push(newAppointment);
            res.status(201).json(newAppointment);
        }
    } catch (error) {
        console.error('Error booking appointment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Function to check for scheduling conflicts
function checkConflict(existingDateTime, newDateTime) {
    // Convert date strings to Date objects for comparison
    const existingDate = new Date(existingDateTime);
    const newDate = new Date(newDateTime);

    // Check for overlapping time slots
    return (
        existingDate.getFullYear() === newDate.getFullYear() &&
        existingDate.getMonth() === newDate.getMonth() &&
        existingDate.getDate() === newDate.getDate() &&
        Math.abs(existingDate - newDate) < 60 * 60 * 1000 // Allow a 1-hour gap between appointments
    );
}

// Endpoint to Get Hospital Recommendations
app.post('/api/appointments/recommend-hospitals', async (req, res) => {
    const { symptoms } = req.body;

    try {
        // Use your symptom analysis logic to recommend hospitals based on symptoms
        const recommendedHospitals = await recommendHospitals(symptoms);

        // Return response with recommended hospitals
        res.json({ recommendedHospitals });
    } catch (error) {
        console.error('Error getting hospital recommendations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to Book Appointment with Selected Hospital
app.post('/api/appointments/book-selected', async (req, res) => {
    try {
        if (!req.session || !req.session.user || !req.session.user.patientId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { name, age, email, appointmentDateTime, selectedHospital } = req.body;
        const newAppointment = {
            id: Date.now().toString(),
            name,
            age,
            email,
            appointmentDateTime,
            hospital: selectedHospital,
        };

        // Check for scheduling conflicts
        const existingAppointments = await usersRef.child(req.session.user.patientId).child('appointments').once('value');
        let hasConflict = false;

        existingAppointments.forEach((childSnapshot) => {
            const existingAppointment = childSnapshot.val();
            if (checkConflict(existingAppointment.appointmentDateTime, appointmentDateTime)) {
                hasConflict = true;
            }
        });

        if (hasConflict) {
            return res.status(409).json({ error: 'Scheduling conflict detected. Please choose another time slot.' });
        }

        await usersRef.child(req.session.user.patientId).child('appointments').push(newAppointment);
        res.status(201).json({ appointment: newAppointment });
    } catch (error) {
        console.error('Error booking appointment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Function to recommend hospitals based on symptoms
async function recommendHospitals(symptoms) {
    const recommendedHospitals = [];

    //Example Logic for Hospital recommendation
    if (symptoms.includes('headache')) {
        recommendedHospitals.push({ name: 'Hospital A', location: 'City A', specialties: ['Neurology'] });
        recommendedHospitals.push({ name: 'Hospital B', location: 'City B', specialties: ['Neurology'] });
    }

    
    if (symptoms.includes('fracture')) {
        recommendedHospitals.push({ name: 'Hospital C', location: 'City C', specialties: ['Orthopedics'] });
        recommendedHospitals.push({ name: 'Hospital D', location: 'City D', specialties: ['Orthopedics'] });
    }

    
    if (symptoms.includes('fever')) {
        recommendedHospitals.push({ name: 'Hospital E', location: 'City E', specialties: ['Infectious Diseases'] });
        recommendedHospitals.push({ name: 'Hospital F', location: 'City F', specialties: ['Infectious Diseases'] });
    }

    
    if (symptoms.includes('chest pain')) {
        recommendedHospitals.push({ name: 'Hospital G', location: 'City G', specialties: ['Cardiology'] });
        recommendedHospitals.push({ name: 'Hospital H', location: 'City H', specialties: ['Cardiology'] });
    }

    
    if (symptoms.includes('difficulty breathing')) {
        recommendedHospitals.push({ name: 'Hospital I', location: 'City I', specialties: ['Pulmonology'] });
        recommendedHospitals.push({ name: 'Hospital J', location: 'City J', specialties: ['Pulmonology'] });
    }


    if (symptoms.includes('abdominal pain')) {
        recommendedHospitals.push({ name: 'Hospital K', location: 'City K', specialties: ['Gastroenterology'] });
        recommendedHospitals.push({ name: 'Hospital L', location: 'City L', specialties: ['Gastroenterology'] });
    }


    if (symptoms.includes('rash')) {
        recommendedHospitals.push({ name: 'Hospital M', location: 'City M', specialties: ['Dermatology'] });
        recommendedHospitals.push({ name: 'Hospital N', location: 'City N', specialties: ['Dermatology'] });
    }

    return recommendedHospitals;
}



// Endpoint to Delete Appointment
app.delete('/api/appointments/:id', async (req, res) => {
    const appointmentId = req.params.id;

    try {
        await admin.database().ref(`users/${req.session.user.patientId}/appointments/${appointmentId}`).remove();
        res.json({ success: true, message: 'Appointment canceled successfully' });
    } catch (error) {
        console.error('Error canceling appointment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to Get User's Appointments
app.get('/api/appointments/my-appointments', async (req, res) => {
    try {
        if (!req.session || !req.session.user || !req.session.user.patientId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userAppointmentsSnapshot = await usersRef.child(req.session.user.patientId).child('appointments').once('value');
        const userAppointments = [];

        userAppointmentsSnapshot.forEach((childSnapshot) => {
            userAppointments.push(childSnapshot.val());
        });

        res.json(userAppointments);
    } catch (error) {
        console.error('Error getting user appointments:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Edit Appointment Route
app.put('/api/appointments/:id', async (req, res) => {
    const appointmentId = req.params.id;
    const updatedAppointmentData = req.body;

    try {
        const userRef = usersRef.child(req.session.user.patientId).child('appointments');
        await userRef.child(appointmentId).update(updatedAppointmentData);
        res.json({ success: true, message: 'Appointment updated successfully' });
    } catch (error) {
        console.error('Error updating appointment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to fetch EHR data for a specific user
app.get('/api/ehr/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        const userSnapshot = await admin.database().ref(`users/${userId}`).once('value');
        const userData = userSnapshot.val();

        if (!userData || !userData.healthRecords) {
            return res.status(404).json({ error: 'User or health records not found' });
        }

        const healthRecords = userData.healthRecords;
        res.json({ success: true, healthRecords });
    } catch (error) {
        console.error('Error fetching EHR data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to download EHR as PDF
app.get('/api/download/ehr/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        const userSnapshot = await admin.database().ref(`users/${userId}`).once('value');
        const userData = userSnapshot.val();

        if (!userData || !userData.healthRecords) {
            return res.status(404).json({ error: 'User or health records not found' });
        }

        const healthRecords = userData.healthRecords;

        // Create PDF document
        const doc = new PDFDocument();
        doc.pipe(fs.createWriteStream('ehr.pdf')); // Save PDF to file

        // Customize PDF content
        doc.fontSize(16).text('Electronic Health Record', { align: 'center' }).moveDown();
        doc.fontSize(12).text(`Name: ${healthRecords.Name}`).moveDown();
        doc.fontSize(12).text(`Date of Birth: ${healthRecords.dateOfBirth}`).moveDown();
        doc.fontSize(12).text(`Gender: ${healthRecords.gender}`).moveDown();
        doc.fontSize(12).text(`Blood Group: ${healthRecords.bloodType}`).moveDown();
        doc.fontSize(12).text(`Conditions: ${healthRecords.conditions.conditionName}`).moveDown();
        doc.fontSize(12).text(`Medications: ${healthRecords.medications.medicationName} Dosage: ${healthRecords.medications.dosage}`).moveDown();
        doc.fontSize(12).text(`Surgeries: ${healthRecords.surgeries.surgeryName}`).moveDown();
        doc.fontSize(12).text(`Treatments: ${healthRecords.treatments.treatmentName}`).moveDown();
        doc.fontSize(12).text(`Vaccinations: ${healthRecords.vaccinations.vaccineName}`).moveDown();
        // Add more content as needed

        doc.end(); // End PDF creation

        res.download('ehr.pdf'); // Download the PDF
    } catch (error) {
        console.error('Error downloading EHR as PDF:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/expenses/add', async (req, res) => {
    const { date, description, amount } = req.body;
    const newExpense = { date, description, amount };

    try {
        await usersRef.child(req.session.user.patientId).child('medicalExpenses').push(newExpense);
        res.status(201).json({ success: true, message: 'Expense added successfully' });
    } catch (error) {
        console.error('Error adding medical expense:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to Fetch All Medical Expenses
app.get('/api/expenses/all', async (req, res) => {
    try {
        const expensesSnapshot = await usersRef.child(req.session.user.patientId).child('medicalExpenses').once('value');
        const expenses = [];
        expensesSnapshot.forEach((childSnapshot) => {
            expenses.push(childSnapshot.val());
        });
        res.json(expenses);
    } catch (error) {
        console.error('Error fetching medical expenses:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});



// Logout Endpoint
app.get('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
