require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const connectDB = require("./config/db");

const authRoutes = require("./routes/auth.js");
const productRoutes = require("./routes/product");
const sellRequestRoutes = require("./routes/sellRequest");
const adminRoutes = require("./routes/admin");
const sellerFromRoutes = require("./routes/sellerForm.js");
const reviewRoutes = require("./routes/reviewRoutes");
const cartRoutes = require("./routes/cartRoutes");
const notificationRoutes = require("./routes/notificationsRoutes.js");
const orderRoutes = require("./routes/orderRoutes.js");
const uploadRoutes = require("./routes/uploadRoutes");
const categoryRoutes = require("./routes/category");
const outletRoutes = require("./routes/outletRoutes.js");

const app = express();
const PORT = process.env.PORT || 5000;

connectDB();

// CORS configuration for production
const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  "http://localhost:5173",
  "https://recycle-trade.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg =
          "The CORS policy for this site does not allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.use('/api/webhooks/stripe', require('./api/webhooks/stripe'));
// middleware for other routes (NO express.raw() for webhooks)
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));


// Basic route
app.get("/", (req, res) =>
  res.json({
    message: "RecycleTrade API running",
    timestamp: new Date().toISOString(),
  })
);

// Health check route
app.get("/health", (req, res) =>
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  })
);

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sellrequests", sellRequestRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/seller-company", sellerFromRoutes);
app.use("/api/products", reviewRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/outlets", outletRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/orders", orderRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || "Server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Only listen if not in Vercel
if (process.env.NODE_ENV !== "production" || process.env.VERCEL !== "1") {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
