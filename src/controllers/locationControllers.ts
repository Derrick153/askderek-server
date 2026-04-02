import { Request, Response } from "express";
import {
  getAllRegions,
  getCitiesByRegion,
  getAreasByCity,
  getAllCities,
  searchAllLocations,
  validateLocation,
} from "../lib/ghanaLocations";
import { prisma } from "../lib/prisma";

// ─────────────────────────────────────────────
// SAFE DB COUNT (NO CRASH)
// ─────────────────────────────────────────────
const safeCount = async (where: any): Promise<number> => {
  try {
    return await prisma.property.count({ where });
  } catch (error) {
    console.error("DB COUNT ERROR:", error);
    return 0; // fallback instead of crash
  }
};

// ─────────────────────────────────────────────
// GET REGIONS
// ─────────────────────────────────────────────
export const getRegions = async (_: Request, res: Response) => {
  try {
    const regions = getAllRegions();

    const regionsWithCount = await Promise.all(
      regions.map(async (region) => ({
        ...region,
        propertyCount: await safeCount({
          status: "Approved",
          location: { region: region.name },
        }),
      }))
    );

    res.json(regionsWithCount);
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to fetch regions",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────
// GET CITIES
// ─────────────────────────────────────────────
export const getCities = async (req: Request, res: Response) => {
  try {
    const { regionSlug } = req.params;

    if (!regionSlug) {
      return res.status(400).json({ message: "regionSlug is required" });
    }

    const data = getCitiesByRegion(regionSlug);

    const citiesWithCount = await Promise.all(
      data.cities.map(async (city) => ({
        ...city,
        propertyCount: await safeCount({
          status: "Approved",
          location: { city: city.name },
        }),
      }))
    );

    res.json({
      region: data.region,
      cities: citiesWithCount,
    });
  } catch (error: any) {
    res.status(404).json({
      message: error.message || "Region not found",
    });
  }
};

// ─────────────────────────────────────────────
// GET AREAS
// ─────────────────────────────────────────────
export const getAreas = async (req: Request, res: Response) => {
  try {
    const { regionSlug, citySlug } = req.params;

    if (!regionSlug || !citySlug) {
      return res.status(400).json({
        message: "regionSlug and citySlug are required",
      });
    }

    const data = getAreasByCity(regionSlug, citySlug);

    const areasWithCount = await Promise.all(
      data.areas.map(async (area) => ({
        ...area,
        propertyCount: await safeCount({
          status: "Approved",
          location: {
            city: data.city,
            address: {
              contains: area.name,
              mode: "insensitive",
            },
          },
        }),
      }))
    );

    res.json({
      region: data.region,
      city: data.city,
      areas: areasWithCount,
    });
  } catch (error: any) {
    res.status(404).json({
      message: error.message || "Location not found",
    });
  }
};

// ─────────────────────────────────────────────
// SEARCH LOCATIONS
// ─────────────────────────────────────────────
export const searchLocations = async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== "string") {
      return res.status(400).json({
        message: "Query parameter 'q' is required",
      });
    }

    if (q.trim().length < 2) {
      return res.status(400).json({
        message: "Search query must be at least 2 characters",
      });
    }

    const results = searchAllLocations(q.trim());

    res.json({
      query: q.trim(),
      count: results.length,
      results,
    });
  } catch (error: any) {
    res.status(500).json({
      message: "Search failed",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────
// VALIDATE LOCATION
// ─────────────────────────────────────────────
export const checkLocation = async (req: Request, res: Response) => {
  try {
    const { regionSlug, citySlug, areaSlug } = req.body;

    if (!regionSlug || !citySlug || !areaSlug) {
      return res.status(400).json({
        message: "regionSlug, citySlug, and areaSlug are required",
      });
    }

    const result = validateLocation(regionSlug, citySlug, areaSlug);

    if (!result.valid) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      message: "Validation failed",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────
// GET ALL CITIES
// ─────────────────────────────────────────────
export const getCitiesAll = async (_: Request, res: Response) => {
  try {
    const cities = getAllCities();
    res.json(cities);
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to fetch cities",
      error: error.message,
    });
  }
};