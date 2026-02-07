import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Genre } from "../models/genre.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

// Purpose: Creates a new genre with duplicate name checking
const createGenre = asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    throw new ApiError(400, "Genre name is required");
  }

  const existing = await Genre.findOne({
    name: { $regex: `^${name}$`, $options: "i" },
  });
  if (existing) {
    throw new ApiError(400, "Genre already exists");
  }

  const genre = await Genre.create({ name: name.trim() });

  if (!genre) {
    throw new ApiError(500, "Something went wrong while creating genre");
  }

  res
    .status(201)
    .json(new ApiResponse(201, genre, "Genre created successfully"));
});

// Purpose: Updates a genre by ID with duplicate name validation
const updateGenre = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid Genre ID");
  }

  if (!name || !name.trim()) {
    throw new ApiError(400, "Genre name is required");
  }

  const existing = await Genre.findOne({
    name: { $regex: `^${name}$`, $options: "i" },
    _id: { $ne: id },
  });

  if (existing) {
    throw new ApiError(400, "Genre already exists");
  }


  const genre = await Genre.findByIdAndUpdate(
    id,
    { name: name.trim() },
    { new: true }
  );

  if (!genre) {
    throw new ApiError(404, "Genre not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, genre, "Genre updated successfully"));
});

// Purpose: Deletes a genre by ID
const deleteGenre = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid Genre ID");
  }

  const genre = await Genre.findByIdAndDelete(id);

  if (!genre) {
    throw new ApiError(404, "Genre not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, genre, "Genre deleted successfully"));
});

// Purpose: Retrieves all genres with pagination and optional search filtering
const getAllGenre = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = "" } = req.query;

  const match = {};
  if (search.trim()) {
    match.name = { $regex: search.trim(), $options: "i" };
  }

  const aggregate = Genre.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
  ]);

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
  };

  const genres = await Genre.aggregatePaginate(aggregate, options);

  res
    .status(200)
    .json(new ApiResponse(200,  genres, "Genres fetched successfully"));
});

export {
  createGenre,
  updateGenre,
  deleteGenre,
  getAllGenre,
};
