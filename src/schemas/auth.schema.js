import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Name must be at least 2 characters").max(100, "Name must be at most 100 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password must be at most 128 characters"),
    roles: z.array(z.enum(["customer", "seller"])).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, "Refresh token is required").optional(),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email address"),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, "Token is required"),
    newPassword: z.string().min(6, "Password must be at least 6 characters").max(128),
  }),
});

export const updatePasswordSchema = z.object({
  body: z.object({
    oldPassword: z.string().min(1, "Old password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters").max(128),
  }),
});

export const verifyEmailSchema = z.object({
  body: z.object({
    otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
  }),
});

export const changeEmailSchema = z.object({
  body: z.object({
    newEmail: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
  }),
});
