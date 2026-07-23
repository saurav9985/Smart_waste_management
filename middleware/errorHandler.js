const mongoose = require("mongoose");
const multer = require("multer");

/**
 * Maps known errors to HTTP status + safe user-facing messages.
 */
function normalizeError(err) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return {
        status: 400,
        message: "Image is too large (max 8 MB).",
        expose: true,
      };
    }
    return {
      status: 400,
      message: err.message || "Upload failed.",
      expose: true,
    };
  }
  if (
    err.message === "Only JPEG, PNG, GIF, or WebP images are allowed."
  ) {
    return { status: 400, message: err.message, expose: true };
  }
  if (err instanceof mongoose.Error.CastError) {
    return { status: 400, message: "Invalid identifier.", expose: true };
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const first = Object.values(err.errors || {})[0];
    return {
      status: 400,
      message: first ? first.message : "Validation failed.",
      expose: true,
    };
  }
  if (err.code === 11000) {
    return {
      status: 409,
      message: "That email is already registered.",
      expose: true,
    };
  }
  if (err.status && err.message) {
    return { status: err.status, message: err.message, expose: true };
  }
  return {
    status: 500,
    message: "Something went wrong. Please try again later.",
    expose: false,
  };
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const { status, message, expose } = normalizeError(err);
  if (status >= 500) {
    console.error("[Waste Watch]", err);
  } else if (!expose) {
    console.error("[Waste Watch]", err);
  }

  if (req.accepts("html")) {
    return res.status(status).render("error", {
      title: status === 500 ? "Server error" : "Error",
      status,
      message,
    });
  }

  res.status(status).json({ error: message });
}

module.exports = errorHandler;
