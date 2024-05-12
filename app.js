const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');
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
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

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
        res.json({ success: true, message: 'User registered successfully' });
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
        res.json({ success: true, message: 'Login successful', userData: { patientId, email: userData.email } });
    } catch (error) {
        console.error('Error logging in user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

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
        const { name, age, email, appointmentDate, appointmentTime, selectedHospital, patientId } = req.body;

        const newAppointment = {
            id: Date.now().toString(),
            name,
            age,
            email,
            appointmentDate,
            appointmentTime,
            hospital: selectedHospital
        };

        // Check for scheduling conflicts
        const existingAppointments = await usersRef.child(patientId).child('appointments').once('value');
        let hasConflict = false;

        existingAppointments.forEach((childSnapshot) => {
            const existingAppointment = childSnapshot.val();
            const appointmentDateTime = new Date(`${existingAppointment.appointmentDate} ${existingAppointment.appointmentTime}`).toISOString();
            const newDateTime = new Date(`${appointmentDate} ${appointmentTime}`).toISOString();

            if (checkConflict(appointmentDateTime, newDateTime)) {
                hasConflict = true;
            }
        });

        if (hasConflict) {
            return res.status(409).json({ error: 'Scheduling conflict detected. Please choose another time slot.' });
        }

        await usersRef.child(patientId).child('appointments').push(newAppointment);
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


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
