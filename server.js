if(process.env.NODE_ENV != "production"){
    require('dotenv').config();
}
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const Bin = require('./models/Bin');
const User = require("./models/User");
const Complaint = require("./models/Complaint");
const asyncHandler = require("./middleware/asyncHandler");
const errorHandler = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 4000;
const SESSION_SECRET =
  process.env.SESSION_SECRET || "change-me-in-production-waste-watch";

const MONGODB_URI = process.env.MONGODB_URL;

// Admin defaults (override via .env)
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@wastewatch.com").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const ADMIN_NAME = process.env.ADMIN_NAME || "Administrator";

const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, "public", "uploads");

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/** Remove an uploaded image under public/uploads (path like /uploads/photo.jpg). */
function safeUnlinkUpload(imagePath) {
  if (!imagePath || typeof imagePath !== "string") return;
  const rel = imagePath.replace(/^\//, "");
  if (!rel.startsWith("uploads/")) return;
  const full = path.normalize(path.join(ROOT, "public", rel));
  const uploadsRoot = path.normalize(UPLOAD_DIR);
  if (!full.startsWith(uploadsRoot)) return;
  try {
    fs.unlinkSync(full);
  } catch (_) {
    /* ignore */
  }
}

function complaintOwnerId(doc) {
  const cit = doc.citizen;
  if (!cit) return null;
  if (typeof cit === "object" && cit._id) return cit._id.toString();
  return cit.toString();
}

function sessionCitizen(req) {
  return req.session && req.session.citizen ? req.session.citizen : null;
}

function citizenToSession(userDoc) {
  return {
    id: userDoc._id.toString(),
    name: userDoc.name,
    email: userDoc.email,
    role: userDoc.role || "citizen",
  };
}

function mapComplaintForView(doc) {
  const c = doc.citizen && typeof doc.citizen === "object" ? doc.citizen : {};
  return {
    id: doc._id.toString(),
    description: doc.description,
    image: doc.image,
    status: doc.status,
    createdAt: doc.createdAt,
    resolvedAt: doc.resolvedAt,
    submittedByName: c.name || null,
    submittedByEmail: c.email || null,
    ownerId: complaintOwnerId(doc),
  };
}

async function fetchReportsForView() {
  const rows = await Complaint.find()
    .sort({ createdAt: -1 })
    .populate("citizen", "name email")
    .lean();
  return rows.map((r) =>
    mapComplaintForView({
      _id: r._id,
      description: r.description,
      image: r.image,
      status: r.status,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      citizen: r.citizen,
    })
  );
}

async function renderIndex(req, res, opts = {}) {
  const { error = null, success = null, status = 200 } = opts;
  const citizen = sessionCitizen(req);
  let reports = [];
  if (citizen) {
    const rows = await fetchReportsForView();
    reports = rows.map((r) => ({
      ...r,
      isOwner: r.ownerId != null && r.ownerId === citizen.id,
    }));
  }
  res.status(status).render("index", {
    reports,
    error,
    success,
    citizen,
  });
}

function requireCitizen(req, res, next) {
  if (!sessionCitizen(req)) {
    const q = new URLSearchParams({ next: req.originalUrl || "/" }).toString();
    return res.redirect(`/login?${q}`);
  }
  next();
}

function requireAdmin(req, res, next) {
  const user = sessionCitizen(req);
  if (!user) {
    return res.redirect("/login");
  }
  if (user.role !== "admin") {
    return res.status(403).render("error", {
      title: "Access Denied",
      status: 403,
      message: "You do not have admin privileges to access this page.",
    });
  }
  next();
}

/** Seed admin user on startup */
async function seedAdmin() {
  try {
    const existing = await User.findOne({ email: ADMIN_EMAIL });
    if (!existing) {
      await User.create({
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
        role: "admin",
      });
      console.log(`[Waste Watch] Admin account seeded: ${ADMIN_EMAIL}`);
    } else if (existing.role !== "admin") {
      existing.role = "admin";
      await existing.save();
      console.log(`[Waste Watch] Existing user promoted to admin: ${ADMIN_EMAIL}`);
    }
  } catch (err) {
    console.error("[Waste Watch] Admin seed error:", err.message);
  }
}

ensureUploadDir();

if (SESSION_SECRET === "change-me-in-production-waste-watch") {
  console.warn(
    "[Waste Watch] Using default SESSION_SECRET. Set SESSION_SECRET in production."
  );
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    if (!ok) {
      return cb(new Error("Only JPEG, PNG, GIF, or WebP images are allowed."));
    }
    cb(null, true);
  },
});

app.set("view engine", "ejs");
app.set("views", path.join(ROOT, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    name: "wastewatch.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(express.static(path.join(ROOT, "public")));

app.get(
  "/",
  asyncHandler(async (req, res) => {
    await renderIndex(req, res);
  })
);

app.get("/login", (req, res) => {
  if (sessionCitizen(req)) {
    const nextUrl = (req.query.next || "/").toString();
    const safe = nextUrl.startsWith("/") ? nextUrl : "/";
    return res.redirect(safe);
  }
  res.render("login", {
    citizen: null,
    error: null,
    nextUrl: (req.query.next || "/").toString(),
    selectedRole: req.query.role || "citizen",
  });
});

app.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const role = (req.body.role || "citizen").trim().toLowerCase();
    const nextRaw = (req.body.next || req.query.next || "/").toString();
    const nextUrl = nextRaw.startsWith("/") ? nextRaw : "/";

    if (!email || !password) {
      return res.status(400).render("login", {
        citizen: null,
        error: "Enter your email and password.",
        nextUrl,
        selectedRole: role,
      });
    }

    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).render("login", {
        citizen: null,
        error: "Invalid email or password.",
        nextUrl,
        selectedRole: role,
      });
    }

    // Role verification
    if (role === "admin" && user.role !== "admin") {
      return res.status(403).render("login", {
        citizen: null,
        error: "This account does not have admin privileges.",
        nextUrl,
        selectedRole: role,
      });
    }

    if (role === "citizen" && user.role === "admin") {
      // Allow admin to log in as citizen if they want, but set role to citizen in session
      req.session.citizen = { ...citizenToSession(user), role: "citizen" };
    } else {
      req.session.citizen = citizenToSession(user);
    }
    res.redirect(nextUrl);
  })
);

app.get("/register", (req, res) => {
  if (sessionCitizen(req)) {
    return res.redirect("/");
  }
  res.render("register", { citizen: null, error: null });
});

app.post(
  "/register",
  asyncHandler(async (req, res) => {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const mobileNumber = (req.body.mobileNumber || "").trim();
    const password = req.body.password || "";
    const confirm = req.body.confirm || "";

    if (!name || !email || !password) {
      return res.status(400).render("register", {
        citizen: null,
        error: "Name, email, and password are required.",
      });
    }
    if (password.length < 8) {
      return res.status(400).render("register", {
        citizen: null,
        error: "Password must be at least 8 characters.",
      });
    }
    if (password !== confirm) {
      return res.status(400).render("register", {
        citizen: null,
        error: "Passwords do not match.",
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).render("register", {
        citizen: null,
        error: "Enter a valid email address.",
      });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).render("register", {
        citizen: null,
        error: "An account with that email already exists. Try logging in.",
      });
    }

    if (mobileNumber) {
      const existingMobile = await User.findOne({ mobileNumber });
      if (existingMobile) {
        return res.status(409).render("register", {
          citizen: null,
          error: "An account with that mobile number already exists.",
        });
      }
    }

    try {
      const user = await User.create({
        name,
        email,
        mobileNumber: mobileNumber || undefined,
        passwordHash: bcrypt.hashSync(password, 10),
        role: "citizen",
      });
      req.session.citizen = citizenToSession(user);
      res.redirect("/?registered=1");
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).render("register", {
          citizen: null,
          error: "An account with that email already exists. Try logging in.",
        });
      }
      throw err;
    }
  })
);

app.get("/login/otp", (req, res) => {
  if (sessionCitizen(req)) return res.redirect("/");
  res.render("login-otp", { citizen: null, error: null });
});

app.post("/login/otp/send", asyncHandler(async (req, res) => {
  if (sessionCitizen(req)) return res.redirect("/");
  const mobileNumber = (req.body.mobileNumber || "").trim();
  if (!mobileNumber) {
    return res.status(400).render("login-otp", { citizen: null, error: "Enter your mobile number." });
  }

  const user = await User.findOne({ mobileNumber });
  if (!user) {
    return res.status(404).render("login-otp", { citizen: null, error: "No account found with that mobile number. Please register or log in with email." });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  req.session.otpData = { otp, mobile: mobileNumber, expiry: Date.now() + 5 * 60 * 1000 };
  
  console.log(`\n\n[MOCK SMS] OTP for ${mobileNumber} is: ${otp}\n\n`);

  res.redirect("/login/otp/verify");
}));

app.get("/login/otp/verify", (req, res) => {
  if (sessionCitizen(req)) return res.redirect("/");
  if (!req.session.otpData || req.session.otpData.expiry < Date.now()) {
     return res.redirect("/login/otp");
  }
  res.render("login-otp-verify", { citizen: null, error: null, mobile: req.session.otpData.mobile });
});

app.post("/login/otp/verify", asyncHandler(async (req, res) => {
  if (sessionCitizen(req)) return res.redirect("/");
  const code = (req.body.code || "").trim();
  
  if (!req.session.otpData || req.session.otpData.expiry < Date.now()) {
     return res.redirect("/login/otp");
  }

  if (code !== req.session.otpData.otp) {
     return res.status(401).render("login-otp-verify", { citizen: null, error: "Invalid or expired OTP.", mobile: req.session.otpData.mobile });
  }

  const user = await User.findOne({ mobileNumber: req.session.otpData.mobile });
  if (!user) {
     return res.redirect("/login/otp");
  }

  req.session.citizen = citizenToSession(user);
  delete req.session.otpData;
  res.redirect("/");
}));

app.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.redirect("/");
  });
});

app.post(
  "/reports",
  requireCitizen,
  (req, res, next) => {
    upload.single("photo")(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const description = (req.body.description || "").trim();
    if (!description) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {
          /* ignore */
        }
      }
      return renderIndex(req, res, {
        error: "Please describe the waste area.",
        status: 400,
      });
    }
    if (!req.file) {
      return renderIndex(req, res, {
        error: "Please upload a photo of the area.",
        status: 400,
      });
    }

    const c = sessionCitizen(req);
    const citizenId = new mongoose.Types.ObjectId(c.id);

    try {
      await Complaint.create({
        description,
        image: `/uploads/${req.file.filename}`,
        status: "open",
        citizen: citizenId,
      });
      res.redirect("/?posted=1");
    } catch (err) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        /* ignore */
      }
      throw err;
    }
  })
);

app.post(
  "/reports/:id/resolve",
  requireCitizen,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect("/");
    }
    const updated = await Complaint.findByIdAndUpdate(
      id,
      { status: "resolved", resolvedAt: new Date() },
      { new: true, runValidators: true }
    );
    if (!updated) {
      return res.redirect("/");
    }
    res.redirect("/?resolved=1");
  })
);

app.post(
  "/reports/:id/reopen",
  requireCitizen,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect("/");
    }
    const updated = await Complaint.findByIdAndUpdate(
      id,
      { status: "open", resolvedAt: null },
      { new: true, runValidators: true }
    );
    if (!updated) {
      return res.redirect("/");
    }
    res.redirect("/");
  })
);

app.post(
  "/reports/:id/delete",
  requireCitizen,
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect("/");
    }
    const complaint = await Complaint.findById(id);
    if (!complaint) {
      return res.redirect("/");
    }
    const sessionId = req.session.citizen.id;
    if (!complaint.citizen.equals(new mongoose.Types.ObjectId(sessionId))) {
      const err = new Error(
        "You can only delete complaints that you submitted."
      );
      err.status = 403;
      return next(err);
    }
    const imagePath = complaint.image;
    await Complaint.deleteOne({ _id: complaint._id });
    safeUnlinkUpload(imagePath);
    res.redirect("/?deleted=1");
  })
);

// ─── Bins API ───────────────────────────────────────────────────────
// Get all bins (JSON)
app.get('/bins', async (req, res) => {
    try {
        const bins = await Bin.find();
        res.json(bins);
    } catch (err) {
        res.status(500).send("Error fetching bins");
    }
});

// Bins page
app.get("/bins-page", (req, res) => {
  res.render("bins", {
    citizen: req.session.citizen || null,
  });
});
app.get("/bin-page", (req, res) => {
  res.redirect("/bins-page");
});

// ─── Admin: Bin Management ──────────────────────────────────────────
// Install new bin (form)
app.get(
  "/admin/install-bin",
  requireAdmin,
  (req, res) => {
    res.render("install-bin", {
      citizen: sessionCitizen(req),
      error: null,
      success: null,
    });
  }
);

// Install new bin (submit)
app.post(
  "/admin/install-bin",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const location = (req.body.location || "").trim();
    const level = parseInt(req.body.level, 10);
    const status = req.body.status || "Empty";

    if (!location) {
      return res.status(400).render("install-bin", {
        citizen: sessionCitizen(req),
        error: "Location is required.",
        success: null,
      });
    }

    if (isNaN(level) || level < 0 || level > 100) {
      return res.status(400).render("install-bin", {
        citizen: sessionCitizen(req),
        error: "Fill level must be a number between 0 and 100.",
        success: null,
      });
    }

    const validStatuses = ["Empty", "Full", "Needs Cleaning"];
    if (!validStatuses.includes(status)) {
      return res.status(400).render("install-bin", {
        citizen: sessionCitizen(req),
        error: "Invalid status selected.",
        success: null,
      });
    }

    await Bin.create({ location, level, status });

    return res.redirect("/bins-page");
  })
);

// Edit bin (form)
app.get(
  "/admin/edit-bin/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect("/bins-page");
    }
    const bin = await Bin.findById(id);
    if (!bin) {
      return res.redirect("/bins-page");
    }
    res.render("edit-bin", {
      citizen: sessionCitizen(req),
      bin,
      error: null,
    });
  })
);

// Edit bin (submit)
app.post(
  "/admin/edit-bin/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect("/bins-page");
    }

    const location = (req.body.location || "").trim();
    const level = parseInt(req.body.level, 10);
    const status = req.body.status || "Empty";

    const bin = await Bin.findById(id);
    if (!bin) {
      return res.redirect("/bins-page");
    }

    if (!location) {
      return res.status(400).render("edit-bin", {
        citizen: sessionCitizen(req),
        bin,
        error: "Location is required.",
      });
    }

    if (isNaN(level) || level < 0 || level > 100) {
      return res.status(400).render("edit-bin", {
        citizen: sessionCitizen(req),
        bin,
        error: "Fill level must be a number between 0 and 100.",
      });
    }

    const validStatuses = ["Empty", "Full", "Needs Cleaning"];
    if (!validStatuses.includes(status)) {
      return res.status(400).render("edit-bin", {
        citizen: sessionCitizen(req),
        bin,
        error: "Invalid status selected.",
      });
    }

    await Bin.findByIdAndUpdate(id, { location, level, status }, { runValidators: true });
    res.redirect("/bins-page?updated=1");
  })
);

// Delete bin
app.post(
  "/admin/delete-bin/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect("/bins-page");
    }
    await Bin.findByIdAndDelete(id);
    res.redirect("/bins-page?deleted=1");
  })
);

// ─── 404 & Error ────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render("error", {
    title: "Not found",
    status: 404,
    message: "That page does not exist.",
  });
});

app.use(errorHandler);

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`[Waste Watch] MongoDB connected: ${MONGODB_URI}`);

    // Seed admin account
    await seedAdmin();

    app.listen(PORT, () => {
      console.log(`Waste Watch running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("[Waste Watch] MongoDB connection failed:", err.message);
    console.error(
      "Ensure MongoDB is running locally and the database name is correct (default: newproject)."
    );
    process.exit(1);
  }
}

start();
