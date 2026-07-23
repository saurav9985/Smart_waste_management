const mongoose = require('mongoose');

const binSchema = new mongoose.Schema({
    location: { type: String, required: true, trim: true },
    level: { type: Number, required: true, min: 0, max: 100 },
    status: {
        type: String,
        enum: ['Empty', 'Full', 'Needs Cleaning'],
        default: 'Empty',
    },
}, { timestamps: true });

module.exports = mongoose.model('Bin', binSchema);
