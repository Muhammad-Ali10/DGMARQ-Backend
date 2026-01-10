import jwt from "jsonwebtoken";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js"

const verifyJWT = asyncHandler(async (req, _, next) => {

    try {
        const token = req.cookies.accessToken || req.headers.authorization?.split(" ")[1]


        if (!token) {
            throw new ApiError(401, "You are not authorized to access this resource")
        }

        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)

        if (!decodedToken) {
            throw new ApiError(401, "Invaild Token")
        }

        const user = await User.findById(decodedToken?._id).select("-password -refreshToken")

        if (!user) {
            throw new ApiError(404, "User not Found")
        }


        req.user = user
        next()
    } catch (error) {
        throw new ApiError(401, error.message || "You are not authorized to access this resource");
    }

})


const authorizeRoles = (...roles) => {
    return (req, _, next) => {
            // console.log(req.user);
        const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role];
        const hasPermission = roles.some(role => userRoles.includes(role));
        // console.log(userRoles);
        // console.log(hasPermission);
        if (!hasPermission) {
            return next(new ApiError(403, "You are not allowed to access this resource"));
        }
        next();
    };
};

/**
 * Optional JWT verification - doesn't fail if no token provided
 * Sets req.user to null if no valid token
 */
const optionalJWT = asyncHandler(async (req, _, next) => {
    try {
        const token = req.cookies.accessToken || req.headers.authorization?.split(" ")[1];

        if (!token) {
            req.user = null;
            return next();
        }

        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

        if (!decodedToken) {
            req.user = null;
            return next();
        }

        const user = await User.findById(decodedToken?._id).select("-password -refreshToken");

        if (!user) {
            req.user = null;
            return next();
        }

        req.user = user;
        next();
    } catch (error) {
        // If token is invalid, just set user to null and continue
        req.user = null;
        next();
    }
});


export { verifyJWT, authorizeRoles, optionalJWT }