const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const { createObjectCsvWriter } = require('csv-writer');
const ejs = require('ejs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

const app = express();
const port = 3000;

// Database connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'tracker_user', // replace with your MariaDB username
    password: 'Your_Password', // replace with your MariaDB password
    database: 'blood_pressure_tracker'
});

db.connect(err => {
    if (err) throw err;
    console.log('Connected to database');
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.use(express.static('public'));

// GET route for the index page
app.get('/', (req, res) => {
    res.render('index', { successMessage: null }); // Ensure successMessage is defined
});

app.post('/add', (req, res) => {
    const { high_pressure, low_pressure, heartbeat, record_date, record_time } = req.body;

    let recordedAt;

    // If custom date and time are provided, use them
    if (record_date && record_time) {
        recordedAt = new Date(`${record_date}T${record_time}`);
    } else {
        // If not, use the current date and time
        recordedAt = new Date();
    }

    // Debugging: Log the received values
    console.log('Received data:', { high_pressure, low_pressure, heartbeat, record_date, record_time });
    console.log('Recorded At:', recordedAt.toISOString());

    const query = 'INSERT INTO records (high_pressure, low_pressure, heartbeat, recorded_at) VALUES (?, ?, ?, ?)';
    db.query(query, [high_pressure, low_pressure, heartbeat, recordedAt], (err) => {
        if (err) {
            console.error('Error inserting record:', err);
            return res.status(500).send('Error adding record');
        }

        // Render the index page with a success message
        res.render('index', { successMessage: '血壓記錄已成功添加！' });
    });
});

// Ensure that the GET route for the index page also passes successMessage
app.get('/', (req, res) => {
    res.render('index', { successMessage: null }); // Ensure successMessage is defined
});

app.get('/records', (req, res) => {
    db.query('SELECT * FROM records ORDER BY recorded_at DESC', (err, results) => {
        if (err) throw err;

        // Group records by year and month
        const groupedRecords = results.reduce((acc, record) => {
            const date = new Date(record.recorded_at);
            const yearMonth = `${date.getFullYear()}-${date.getMonth() + 1}`; // Format: YYYY-MM

            if (!acc[yearMonth]) {
                acc[yearMonth] = [];
            }
            acc[yearMonth].push({
                ...record,
                formattedDate: date.toLocaleString('zh-HK', {
                    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
                }).replace(',', '')
            });
            return acc;
        }, {});

        res.render('records', { groupedRecords });
    });
});

// Delete a record
app.post('/delete/:id', (req, res) => {
    const recordId = req.params.id;
    const query = 'DELETE FROM records WHERE id = ?';
    db.query(query, [recordId], (err) => {
        if (err) throw err;
        res.redirect('/records');
    });
});

// Function to format the date
function formatDate(date) {
    const options = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
    };

    const formattedDate = date.toLocaleString('zh-HK', options);
    return formattedDate.replace(',', ''); // Remove the comma between date and time
}

// Function to format the date and time for the filename
function formatDateForFilename(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}年${month}月${day}日_${hours}時${minutes}分`;
}

// Export to Excel
app.get('/export/excel', (req, res) => {
    db.query('SELECT * FROM records ORDER BY recorded_at ASC', (err, results) => {
        if (err) throw err;

        // Check if there are any records
        if (results.length === 0) {
            // Render a message indicating no data is available
            return res.render('records', {
                groupedRecords: {},
                noDataMessage: '目前沒有記錄可供匯出。' // Message in Chinese
            });
        }

        // Group records by year and month
        const groupedRecords = results.reduce((acc, record) => {
            const date = new Date(record.recorded_at);
            const yearMonth = `${date.getFullYear()}年${date.getMonth() + 1}月`; // Format: YYYY年MM月

            if (!acc[yearMonth]) {
                acc[yearMonth] = [];
            }
            acc[yearMonth].push({
                高壓: record.high_pressure,
                低壓: record.low_pressure,
                心跳: record.heartbeat,
                記錄時間: formatDate(date) // Format the date for display
            });
            return acc;
        }, {});

        // Create a new workbook
        const workbook = xlsx.utils.book_new();

        // Add each month as a separate sheet
        Object.keys(groupedRecords).forEach(month => {
            const worksheet = xlsx.utils.json_to_sheet(groupedRecords[month]);
            xlsx.utils.book_append_sheet(workbook, worksheet, month);
        });

        // Define the filename
        const today = new Date();
        const formattedDate = formatDateForFilename(today);
        const excelFilename = `血壓記錄_${formattedDate}.xlsx`;

        // Write the workbook to a file
        const excelPath = path.join(__dirname, excelFilename);
        xlsx.writeFile(workbook, excelPath);

        // Download the Excel file
        res.download(excelPath, excelFilename, (err) => {
            if (err) {
                console.error('Error downloading the file:', err);
            } else {
                // Optionally delete the Excel file after downloading
                fs.unlink(excelPath, (err) => {
                    if (err) {
                        console.error('Error deleting the file:', err);
                    } else {
                        console.log('Excel file deleted successfully:', excelPath);
                    }
                });
            }
        });
    });
});

// Check the connection status every 5 minute
setInterval(() => {
    db.query('SELECT 1', (err, results) => {
        if (err) {
            console.error('Database connection lost, reconnecting:', err);
            db.connect((err) => {
                if (err) {
                    console.error('Error reconnecting to database:', err);
                } else {
                    console.log('Reconnected to database');
                }
            });
        } else {
            // Output the result of SELECT 1
            console.log('Database connection is alive. Query result:', results);
        }
    });
}, 300000); // 5 minute

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
