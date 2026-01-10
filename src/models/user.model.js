import mongoose from "mongoose";
import { ROLE } from "../constants.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    password: {
        type: String,
        required: function() {
            return this.oauthProvider === 'local' || !this.oauthProvider;
        }
    },
    oauthProvider: {
        type: String,
        enum: ['local', 'google', 'facebook'],
        default: 'local'
    },
    oauthId: {
        type: String,
        sparse: true,
        index: true
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
    emailVerificationToken: String,
    emailVerificationExpires: Date,
    emailVerificationOTP: String,
    emailVerificationOTPExpires: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    pendingEmail: String,
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: Date,
    loginCount: {
        type: Number,
        default: 0
    },
    roles: {
        type: [String],
        enum: ROLE,
        default: ['customer']
    },
    profileImage: {
        type: String
    },
    refreshToken: {
        type: String
    }
}, { timestamps: true });


userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

userSchema.methods.isPasswordCorrect = async function (password) {
    return await bcrypt.compare(password, this.password);
};


userSchema.methods.generateAccessToken = function () {

    return jwt.sign({
        _id: this._id,
        email: this.email,
        name: this.name,
        roles: this.roles
    },
        process.env.ACCESS_TOKEN_SECRET,
        {
            expiresIn: process.env.ACCESS_TOKEN_EXPIRY
        }

    )
}

userSchema.methods.generateRefreshToken = function () {
    return jwt.sign({
        _id: this._id
    },
        process.env.REFRESH_TOKEN_SECRET,
        {
            expiresIn: process.env.REFRESH_TOKEN_EXPIRY
        }
    )
}

export const User = mongoose.model("User", userSchema)