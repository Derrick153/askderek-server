import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { wktToGeoJSON } from "@terraformer/wkt";
import axios from "axios";

const VALID_HIGHLIGHTS = new Set([
  "HighSpeedInternetAccess", "WasherDryer", "AirConditioning", "Heating",
  "SmokeFree", "CableReady", "SatelliteTV", "DoubleVanities", "TubShower",
  "Intercom", "SprinklerSystem", "RecentlyRenovated", "CloseToTransit",
  "GreatView", "QuietNeighborhood", "SecurityGuard", "Gated",
  "BackupGenerator", "BoreHole",
]);

const VALID_AMENITIES = new Set([
  "WasherDryer", "AirConditioning", "Dishwasher", "HighSpeedInternet",
  "HardwoodFloors", "WalkInClosets", "Microwave", "Refrigerator", "Pool",
  "Gym", "Parking", "PetsAllowed", "WiFi", "Generator", "WaterTank",
  "DSTV", "TiledFloors", "Balcony", "Furnished", "SemiFinished",
]);

const amenityMapping: Record<string, string> = {
  water: "WaterTank", electricity: "Generator", internet: "HighSpeedInternet",
  wifi: "WiFi", furnished: "Furnished", parking: "Parking", pool: "Pool",
  gym: "Gym", ac: "AirConditioning", airconditioning: "AirConditioning",
  dishwasher: "Dishwasher", washer: "WasherDryer", dryer: "WasherDryer",
  pets: "PetsAllowed", microwave: "Microwave", refrigerator: "Refrigerator",
  hardwood: "HardwoodFloors", closets: "WalkInClosets", generator: "Generator",
  watertank: "WaterTank", dstv: "DSTV", balcony: "Balcony", tiled: "TiledFloors",
};

export const getProperties = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      favoriteIds, priceMin, priceMax, beds, baths, propertyType,
      squareFeetMin, squareFeetMax, amenities, availableFrom, latitude, longitude, location,
    } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (favoriteIds) {
      const ids = (favoriteIds as string).split(",").map(Number);
      const placeholders = ids.map(() => `$${paramIndex++}`).join(", ");
      conditions.push(`p.id IN (${placeholders})`);
      params.push(...ids);
    }
    if (priceMin) { conditions.push(`p."pricePerMonth" >= $${paramIndex++}`); params.push(Number(priceMin)); }
    if (priceMax) { conditions.push(`p."pricePerMonth" <= $${paramIndex++}`); params.push(Number(priceMax)); }
    if (beds && beds !== "any") { conditions.push(`p.beds >= $${paramIndex++}`); params.push(Number(beds)); }
    if (baths && baths !== "any") { conditions.push(`p.baths >= $${paramIndex++}`); params.push(Number(baths)); }
    if (squareFeetMin) { conditions.push(`p."squareFeet" >= $${paramIndex++}`); params.push(Number(squareFeetMin)); }
    if (squareFeetMax) { conditions.push(`p."squareFeet" <= $${paramIndex++}`); params.push(Number(squareFeetMax)); }
    if (propertyType && propertyType !== "any") { conditions.push(`p."propertyType" = $${paramIndex++}`); params.push(propertyType); }

    if (amenities && amenities !== "any") {
      const amenitiesArray = (amenities as string).split(",").map((a) => a.trim().toLowerCase());
      const mapped = amenitiesArray.map((a) => amenityMapping[a] || a).filter(Boolean);
      if (mapped.length > 0) {
        const amenityConditions = mapped.map((amenity) => {
          const condition = `$${paramIndex++}::"Amenity" = ANY(p.amenities)`;
          params.push(amenity);
          return condition;
        });
        conditions.push(`(${amenityConditions.join(" OR ")})`);
      }
    }

    if (availableFrom && availableFrom !== "any") {
      conditions.push(`EXISTS (SELECT 1 FROM "Lease" l2 WHERE l2."propertyId" = p.id AND l2."startDate"::date <= $${paramIndex++}::date)`);
      params.push(availableFrom);
    }

    if (latitude && longitude && latitude !== "0" && longitude !== "0") {
      const lat = parseFloat(latitude as string);
      const lng = parseFloat(longitude as string);
      conditions.push(`ST_DWithin(l.coordinates::geography, ST_SetSRID(ST_MakePoint($${paramIndex++}, $${paramIndex++}), 4326)::geography, $${paramIndex++})`);
      params.push(lng, lat, 50000);
    } else if (location) {
      const search = (location as string).trim();
      conditions.push(`(LOWER(l.city) LIKE LOWER($${paramIndex++}) OR LOWER(l.address) LIKE LOWER($${paramIndex++}))`);
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query = `
      SELECT p.*, json_build_object(
        'id', l.id, 'address', l.address, 'city', l.city, 'state', l.state,
        'country', l.country, 'postalCode', l."postalCode",
        'coordinates', json_build_object(
          'longitude', ST_X(l."coordinates"::geometry),
          'latitude', ST_Y(l."coordinates"::geometry)
        )
      ) as location
      FROM "Property" p
      JOIN "Location" l ON p."locationId" = l.id
      ${whereClause}
      ORDER BY p."postedDate" DESC
    `;

    const properties = await prisma.$queryRawUnsafe(query, ...params);
    console.log(`✅ Found ${(properties as any[]).length} properties`);
    res.json(properties);
  } catch (error: any) {
    console.error("❌ Error in getProperties:", error);
    res.status(500).json({ message: `Error retrieving properties: ${error.message}` });
  }
};

export const getProperty = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const property = await prisma.property.findUnique({
      where: { id: Number(id) },
      include: { location: true, manager: true, leases: true },
    });

    if (!property) { res.status(404).json({ message: "Property not found" }); return; }

    const coordinates: { coordinates: string }[] = await prisma.$queryRawUnsafe(
      `SELECT ST_asText(coordinates) as coordinates FROM "Location" WHERE id = $1`,
      property.location.id
    );

    const geoJSON: any = wktToGeoJSON(coordinates[0]?.coordinates || "");
    res.json({
      ...property,
      location: {
        ...property.location,
        coordinates: {
          longitude: geoJSON?.coordinates?.[0] ?? 0,
          latitude: geoJSON?.coordinates?.[1] ?? 0,
        },
      },
    });
  } catch (error: any) {
    console.error("❌ Error retrieving property:", error.message);
    res.status(500).json({ message: `Error retrieving property: ${error.message}` });
  }
};

export const createProperty = async (req: Request, res: Response): Promise<void> => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    const { address, city, state, country, postalCode, managerClerkId, latitude, longitude, photoUrls, ...propertyData } = req.body;

    if (!managerClerkId || !address || !city) {
      res.status(400).json({ message: "managerClerkId, address, and city are required" });
      return;
    }

    let finalPhotoUrls: string[] = [];
    if (photoUrls && Array.isArray(photoUrls)) finalPhotoUrls = photoUrls;
    else if (photoUrls && typeof photoUrls === "string") finalPhotoUrls = [photoUrls];
    else if (files.length > 0) finalPhotoUrls = files.map((f) => `placeholder-${f.originalname}`);

    let lng = longitude ? parseFloat(longitude) : 0;
    let lat = latitude ? parseFloat(latitude) : 0;

    if (!lng || !lat) {
      try {
        const geocodingUrl = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
          street: address, city, country: country || "Ghana",
          postalcode: postalCode || "", format: "json", limit: "1",
        }).toString()}`;
        const geocodingResponse = await axios.get(geocodingUrl, {
          headers: { "User-Agent": "AskDerekRentals (askderek@gmail.com)" },
        });
        if (geocodingResponse.data[0]?.lon) {
          lng = parseFloat(geocodingResponse.data[0].lon);
          lat = parseFloat(geocodingResponse.data[0].lat);
        }
      } catch {
        lng = -1.9942;
        lat = 5.3034;
        console.log("⚠️ Geocoding failed — defaulting to Tarkwa coordinates");
      }
    }

    const location: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "Location" (address, city, state, country, "postalCode", coordinates)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326))
       RETURNING id, address, city, state, country, "postalCode", ST_AsText(coordinates) as coordinates`,
      address, city, state || "Western", country || "Ghana", postalCode || "", lng, lat
    );

    const rawHighlights: string[] = typeof propertyData.highlights === "string"
      ? propertyData.highlights.split(",").map((h: string) => h.trim()).filter(Boolean)
      : Array.isArray(propertyData.highlights) ? propertyData.highlights : [];

    const rawAmenities: string[] = typeof propertyData.amenities === "string"
      ? propertyData.amenities.split(",").map((a: string) => a.trim()).filter(Boolean)
      : Array.isArray(propertyData.amenities) ? propertyData.amenities : [];

    const filteredHighlights = rawHighlights.filter((h) => VALID_HIGHLIGHTS.has(h));
    const filteredAmenities = rawAmenities.filter((a) => VALID_AMENITIES.has(a));

    if (rawHighlights.length !== filteredHighlights.length) {
      console.log(`⚠️ Filtered invalid highlights: ${rawHighlights.filter(h => !VALID_HIGHLIGHTS.has(h)).join(", ")}`);
    }

    const { highlights: _h, amenities: _a, ...cleanPropertyData } = propertyData;

    const newProperty = await prisma.property.create({
      data: {
        ...cleanPropertyData,
        photoUrls: finalPhotoUrls,
        locationId: location[0].id,
        managerClerkId,
        highlights: filteredHighlights,
        amenities: filteredAmenities,
        isPetsAllowed: propertyData.isPetsAllowed === "true" || propertyData.isPetsAllowed === true,
        isParkingIncluded: propertyData.isParkingIncluded === "true" || propertyData.isParkingIncluded === true,
        pricePerMonth: parseFloat(propertyData.pricePerMonth),
        securityDeposit: parseFloat(propertyData.securityDeposit || "0"),
        applicationFee: parseFloat(propertyData.applicationFee || "0"),
        beds: parseInt(propertyData.beds),
        baths: parseFloat(propertyData.baths),
        squareFeet: parseInt(propertyData.squareFeet || "0"),
      },
      include: { location: true, manager: true },
    });

    console.log(`✅ Property created: ${newProperty.name}`);
    res.status(201).json(newProperty);
  } catch (error: any) {
    console.error("❌ Error creating property:", error.message);
    res.status(500).json({ message: `Error creating property: ${error.message}` });
  }
};

// ─── GET PROPERTY LEASES ──────────────────────────────────────────────────────
export const getPropertyLeases = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const leases = await prisma.lease.findMany({
      where: { propertyId: Number(id) },
      include: { tenant: true, payments: true },
      orderBy: { startDate: "desc" },
    });
    console.log(`✅ Found ${leases.length} leases for property ${id}`);
    res.json(leases);
  } catch (error: any) {
    console.error("❌ Error retrieving property leases:", error.message);
    res.status(500).json({ message: `Error retrieving property leases: ${error.message}` });
  }
};