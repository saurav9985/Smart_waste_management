const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    mobileNumber: { 
      type: String, 
      unique: true, 
      sparse: true, 
      trim: true 
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["citizen", "admin"],
      default: "citizen",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
