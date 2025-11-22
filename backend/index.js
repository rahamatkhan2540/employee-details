const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Connect to SQLite
const db = new sqlite3.Database("./database.db");

// Helper function for running SQL statements (using Promises)
const runQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
};

// Create tables if not exist (ON DELETE CASCADE is crucial)
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS departments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL, 
            budget REAL DEFAULT 0
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            salary REAL NOT NULL DEFAULT 0,
            department_id INTEGER,
            FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
        )
    `);
});

// --- Departments CRUD & Report ---
app.get("/departments", (req, res) => {
    db.all("SELECT * FROM departments ORDER BY name", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post("/departments", async (req, res) => {
    const { name, budget } = req.body;
    if (!name) return res.status(400).json({ error: "Department name is required." });
    
    try {
        const numericBudget = parseFloat(budget) || 0;
        const result = await runQuery("INSERT INTO departments (name, budget) VALUES (?, ?)", [name, numericBudget]);
        res.status(201).json({ id: result.lastID, message: "Department created successfully." });
    } catch (err) {
        if (err.message.includes("UNIQUE constraint failed")) return res.status(409).json({ error: "Department name must be unique." });
        res.status(500).json({ error: err.message });
    }
});

app.put("/departments/:id", async (req, res) => {
    const { id } = req.params;
    const { name, budget } = req.body;
    if (!name) return res.status(400).json({ error: "Department name is required." });

    try {
        const numericBudget = parseFloat(budget) || 0;
        const result = await runQuery("UPDATE departments SET name = ?, budget = ? WHERE id = ?", [name, numericBudget, id]);
        if (result.changes === 0) return res.status(404).json({ error: "Department not found." });
        res.json({ message: "Department updated successfully." });
    } catch (err) {
        if (err.message.includes("UNIQUE constraint failed")) return res.status(409).json({ error: "Department name must be unique." });
        res.status(500).json({ error: err.message });
    }
});

app.delete("/departments/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const result = await runQuery("DELETE FROM departments WHERE id = ?", [id]);
        if (result.changes === 0) return res.status(404).json({ error: "Department not found." });
        res.json({ deleted: result.changes, message: "Department deleted successfully." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Report Endpoint
app.get("/departments/report", (req, res) => {
    const deptSql = `
        SELECT 
            d.id, d.name, d.budget, 
            COUNT(e.id) as employee_count,
            SUM(e.salary) as total_salary,
            AVG(e.salary) as average_salary
        FROM departments d
        LEFT JOIN employees e ON d.id = e.department_id
        GROUP BY d.id
        ORDER BY d.name
    `;
    
    db.all(deptSql, (err, departmentData) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all("SELECT id, first_name, last_name, email, salary, department_id FROM employees ORDER BY last_name", (err, employeeData) => {
            if (err) return res.status(500).json({ error: err.message });

            const departmentsMap = new Map(departmentData.map(d => [d.id, { ...d, employees: [] }]));
            
            employeeData.forEach(emp => {
                if (departmentsMap.has(emp.department_id)) {
                    departmentsMap.get(emp.department_id).employees.push(emp);
                }
            });

            res.json(Array.from(departmentsMap.values()));
        });
    });
});


// --- Employees CRUD ---
app.get("/employees", (req, res) => {
    const sql = `
        SELECT e.*, d.name AS department_name
        FROM employees e
        LEFT JOIN departments d ON e.department_id = d.id
        ORDER BY e.last_name
    `;
    db.all(sql, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post("/employees", async (req, res) => {
    const { first_name, last_name, email, salary, department_id } = req.body;
    const numericSalary = parseFloat(salary);
    
    if (!first_name || !last_name || !email) return res.status(400).json({ error: "Required fields missing." });
    if (isNaN(numericSalary) || numericSalary <= 0) return res.status(400).json({ error: "Salary must be a positive number." });
    
    try {
        const result = await runQuery(
            "INSERT INTO employees (first_name, last_name, email, salary, department_id) VALUES (?, ?, ?, ?, ?)",
            [first_name, last_name, email, numericSalary, department_id || null]
        );
        res.status(201).json({ id: result.lastID, message: "Employee created successfully." });
    } catch (err) {
        if (err.message.includes("UNIQUE constraint failed")) return res.status(409).json({ error: "Email address must be unique." });
        res.status(500).json({ error: err.message });
    }
});

app.put("/employees/:id", async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, email, salary, department_id } = req.body;
    const numericSalary = parseFloat(salary);

    if (!first_name || !last_name || !email) return res.status(400).json({ error: "Required fields missing." });
    if (isNaN(numericSalary) || numericSalary <= 0) return res.status(400).json({ error: "Salary must be a positive number." });

    try {
        const result = await runQuery(
            "UPDATE employees SET first_name = ?, last_name = ?, email = ?, salary = ?, department_id = ? WHERE id = ?",
            [first_name, last_name, email, numericSalary, department_id || null, id]
        );
        if (result.changes === 0) return res.status(404).json({ error: "Employee not found." });
        res.json({ message: "Employee updated successfully." });
    } catch (err) {
        if (err.message.includes("UNIQUE constraint failed")) return res.status(409).json({ error: "Email address must be unique." });
        res.status(500).json({ error: err.message });
    }
});

app.delete("/employees/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const result = await runQuery("DELETE FROM employees WHERE id = ?", [id]);
        if (result.changes === 0) return res.status(404).json({ error: "Employee not found." });
        res.json({ deleted: result.changes, message: "Employee deleted successfully." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start backend
const PORT = 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));