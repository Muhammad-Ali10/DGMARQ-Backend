import { User } from "../models/user.model.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import bcrypt from "bcrypt";
import { fileUploader } from "../utils/cloudinary.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";



const generateRefreshTokenAndAccessToken = async (userid) => {

    const user = await User.findById(userid)

    const accessToken = await user.generateAccessToken(user?._id)

    const refreshToken = await user.generateRefreshToken(user?._id)

    const bcryptRefreshToken = await bcrypt.hash(refreshToken, 10)

    user.refreshToken = bcryptRefreshToken

    user.save({
        validateBeforeSave: true
    })

    return { accessToken, refreshToken }
}



const registerUser = asyncHandler(async (req, res) => {

    const { name, email, password, roles } = req.body

    const localfilePath = req.file.path

    if (!name || !email || !password) {
        throw new ApiError(409, "All fields are required")
    }

    if (!localfilePath) {
        throw new ApiError(409, "All fields are required")
    }

    const profileImagePath = await fileUploader(localfilePath)

    if (!profileImagePath) {

        throw new ApiError(500, "Some Thing Went Wrong")
    }

    const existingUser = await User.findOne({ email })

    if (existingUser) {
        throw new ApiError(409, "User already exists")
    }

    const user = await User.create({
        name,
        email,
        password,
        roles,
        profileImage: profileImagePath.url
    })

    if (!user) {
        throw new ApiError(404, "User not created")
    }

    return res.status(201).json(new ApiResponse(201, user, "User created successfully"))

})


const loginUser = asyncHandler(async (req, res) => {

    const { email, password } = req.body

    if (!email || !password) {
        throw new ApiError(409, "All the feild requried")
    }

    console.log(email, password);


    const user = await User.findOne({ email })

    if (!user) {
        throw new ApiError(404, "User not Found")
    }

    const isPasswordValidate = await user.isPasswordCorrect(password)

    if (!isPasswordValidate) {
        throw new ApiError(401, "Password Wrong")
    }

    const { accessToken, refreshToken } = await generateRefreshTokenAndAccessToken(user._id)



    const userAsSeller = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(user._id)
            }
        },
        {
            $lookup: {
                from: "sellers",
                localField: "_id",
                foreignField: "userId",
                as: "seller"
            }
        },
        {
            $unwind: {
                path: "$seller",
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $project: {
                name: 1,
                email: 1,
                roles: 1,
                profileImage: 1,
                seller: {
                    shopName: "$seller.shopName",
                    shopLogo: "$seller.shopLogo",
                    shopBanner: "$seller.shopBanner",
                    description: "$seller.description",
                    country: "$seller.country",
                    state: "$seller.state",
                    city: "$seller.city",
                    payoutAccount: "$seller.payoutAccount",
                    kycDocs: "$seller.kycDocs",
                    rating: "$seller.rating",
                    status: "$seller.status",
                    minPayoutAmount: "$seller.minPayoutAmount",
                    payoutAutoRelease: "$seller.payoutAutoRelease"
                }
            }
        }
    ]);

    const loginUser = { ...user._doc }

    const opition = {
        httpOnly: true,
        secure: true,
    }

    res.status(200)
        .cookie("accessToken", accessToken, opition)
        .cookie("refreshToken", refreshToken, opition)
        .json(
            new ApiResponse(200, {
                user: userAsSeller,
                accessToken,
                refreshToken
            }, "User logged in successfully")
        )

})


const refershAccessToken = asyncHandler(async (req, res) => {

    const incomingRefreshToken = (req.cookies?.refreshToken) || (req.body?.refreshToken);

    if (!incomingRefreshToken) {
        throw new ApiError(401, "unauthorize")
    }

    try {

        const decoded = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)
        const user = await User.findById(decoded._id)
        if (!user) {
            throw new ApiError(404, "User not found")
        }

        const isRefreshTokenValid = await bcrypt.compare(incomingRefreshToken, user.refreshToken)

        if (!isRefreshTokenValid) {
            throw new ApiError(401, "unauthorize")
        }

        const { accessToken, refreshToken } = await user.generateRefreshTokenAndAccessToken(user._id)

        const opition = {
            httpOnly: true,
            secure: true,
        }
        res.status(200)
            .cookie("accessToken", accessToken, opition)
            .cookie("refreshToken", refreshToken, opition)
            .json(
                new ApiResponse(200, {
                    refreshToken,
                    accessToken
                }, "Refersh Token successfully")
            )

    } catch (error) {
        throw new ApiError(401, "unauthorize")
    }

})


const logoutUser = asyncHandler(async (req, res) => {

    const user = await User.findById(req.user._id)

    if (!user) {
        throw new ApiError(404, "User not found")
    }

    user.refreshToken = undefined

    await user.save({
        validateBeforeSave: true
    })

    const opition = {
        httpOnly: true,
        secure: true,
    }

    res.status(200)
        .cookie("accessToken", opition)
        .cookie("refreshToken", opition)
        .json(
            new ApiResponse(200, {}, "User logged out successfully")
        )

})


const updateProfile = asyncHandler(async (req, res) => {

    const localfilePath = req.file.path

    if (localfilePath) {
        throw new ApiError(409, "All fields are required")
    }

    const user = await User.findById(req.user._id)

    if (!user) {
        throw new ApiError(404, "User not found")
    }

    const profileImagePath = await fileUploader(localfilePath)

    if (!profileImagePath) {
        throw new ApiError(404, "Something went wrong")
    }

    user.profileImage = profileImagePath

    await user.save({
        validateBeforeSave: true
    })

    res.status(200).json(new ApiResponse(200, user, "Profile updated successfully"))

})


const updatePassword = asyncHandler(async (req, res) => {

    const { oldPassword, newPassword } = req.body
    const user = await User.findById(req.user._id)

    if (!user) {
        throw new ApiError(404, "User not found")
    }
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

    if (!isPasswordCorrect) {
        throw new ApiError(401, "Password wrong")
    }
    user.password = newPassword

    await user.save({
        validateBeforeSave: true
    })

    res.status(200).json(new ApiResponse(200, user, "Password updated successfully"))

})


export { registerUser, loginUser, refershAccessToken, logoutUser, updateProfile, updatePassword }