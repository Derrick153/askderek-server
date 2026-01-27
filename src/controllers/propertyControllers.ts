import { Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import { wktToGeoJSON } from "@terraformer/wkt";
import { Location } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();

export const getProperties = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      favoriteIds, priceMin, priceMax, beds, baths, propertyType,
      squareFeetMin, squareFeetMax, amenities, availableFrom, latitude, longitude,
    } = req.query;

    let whereConditions: Prisma.Sql[] = [];

    if (favoriteIds) {
      const favoriteIdsArray = (favoriteIds as string).split(",").map(Number);
      whereConditions.push(Prisma.sql`p.id IN (${Prisma.join(favoriteIdsArray)})`);
    }
    if (priceMin) whereConditions.push(Prisma.sql`p."pricePerMonth" >= ${Number(priceMin)}`);
    if (priceMax) whereConditions.push(Prisma.sql`p."pricePerMonth" <= ${Number(priceMax)}`);
    if (beds && beds !== "any") whereConditions.push(Prisma.sql`p.beds >= ${Number(beds)}`);
    if (baths && baths !== "any") whereConditions.push(Prisma.sql`p.baths >= ${Number(baths)}`);
    if (squareFeetMin) whereConditions.push(Prisma.sql`p."squareFeet" >= ${Number(squareFeetMin)}`);
    if (squareFeetMax) whereConditions.push(Prisma.sql`p."squareFeet" <= ${Number(squareFeetMax)}`);
    if (propertyType && propertyType !== "any") {
      whereConditions.push(Prisma.sql`p."propertyType" = ${propertyType}::"PropertyType"`);
    }
    if (amenities && amenities !== "any") {
      const amenitiesArray = (amenities as string).split(",");
      whereConditions.push(Prisma.sql`p.amenities @> ${amenitiesArray}`);
    }
    if (availableFrom && availableFrom !== "any") {
      const availableFromDate = typeof availableFrom === "string" ? availableFrom : null;
      if (availableFromDate) {
        const date = new Date(availableFromDate);
        if (!isNaN(date.getTime())) {
          whereConditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "Lease" l WHERE l."propertyId" = p.id AND l."startDate" <= ${date.toISOString()})`);
        }
      }
    }
    if (latitude && longitude) {
      const lat = parseFloat(latitude as string);
      const lng = parseFloat(longitude as string);
      const radiusInKilometers = 1000;
      const degrees = radiusInKilometers / 111;
      whereConditions.push(Prisma.sql`ST_DWithin(l.coordinates::geometry, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), ${degrees})`);
    }

    const completeQuery = Prisma.sql`
      SELECT p.*, json_build_object(
        'id', l.id, 'address', l.address, 'city', l.city, 'state', l.state,
        'country', l.country, 'postalCode', l."postalCode",
        'coordinates', json_build_object('longitude', ST_X(l."coordinates"::geometry), 'latitude', ST_Y(l."coordinates"::geometry))
      ) as location
      FROM "Property" p
      JOIN "Location" l ON p."locationId" = l.id
      ${whereConditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(whereConditions, " AND ")}` : Prisma.empty}
    `;

    const properties = await prisma.$queryRaw(completeQuery);
    res.json(properties);
  } catch (error: any) {
    res.status(500).json({ message: `Error retrieving properties: ${error.message}` });
  }
};

export const getProperty = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const property = await prisma.property.findUnique({
      where: { id: Number(id) },
      include: { location: true },
    });

    if (property) {
      const coordinates: { coordinates: string }[] = await prisma.$queryRaw`SELECT ST_asText(coordinates) as coordinates from "Location" where id = ${property.location.id}`;
      const geoJSON: any = wktToGeoJSON(coordinates[0]?.coordinates || "");
      const longitude = geoJSON.coordinates[0];
      const latitude = geoJSON.coordinates[1];

      const propertyWithCoordinates = {
        ...property,
        location: {
          ...property.location,
          coordinates: { longitude, latitude },
        },
      };
      res.json(propertyWithCoordinates);
    }
  } catch (err: any) {
    res.status(500).json({ message: `Error retrieving property: ${err.message}` });
  }
};

export const createProperty = async (req: Request, res: Response): Promise<void> => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    const { address, city, state, country, postalCode, managerClerkId, latitude, longitude, photoUrls, ...propertyData } = req.body;

    let finalPhotoUrls: string[] = [];

    // If photoUrls provided in JSON (from Postman), use those
    if (photoUrls && Array.isArray(photoUrls)) {
      finalPhotoUrls = photoUrls;
    } 
    // Otherwise process uploaded files (from form)
    else if (files && files.length > 0) {
      // TODO: Upload to Supabase Storage
      finalPhotoUrls = files.map(f => `placeholder-${f.originalname}`);
    }

    // Use provided coordinates or geocode the address
    let lng = longitude ? parseFloat(longitude) : 0;
    let lat = latitude ? parseFloat(latitude) : 0;

    if (!lng || !lat) {
      const geocodingUrl = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
        street: address, city, country, postalcode: postalCode, format: "json", limit: "1",
      }).toString()}`;
      const geocodingResponse = await axios.get(geocodingUrl, {
        headers: { "User-Agent": "RealEstateApp (justsomedummyemail@gmail.com)" },
      });
      if (geocodingResponse.data[0]?.lon && geocodingResponse.data[0]?.lat) {
        lng = parseFloat(geocodingResponse.data[0].lon);
        lat = parseFloat(geocodingResponse.data[0].lat);
      }
    }

    // Create location
    const [location] = await prisma.$queryRaw<Location[]>`
      INSERT INTO "Location" (address, city, state, country, "postalCode", coordinates)
      VALUES (${address}, ${city}, ${state}, ${country}, ${postalCode}, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
      RETURNING id, address, city, state, country, "postalCode", ST_AsText(coordinates) as coordinates;
    `;

    // Create property
    const newProperty = await prisma.property.create({
      data: {
        ...propertyData,
        photoUrls: finalPhotoUrls,
        locationId: location.id,
        managerClerkId,
        amenities: typeof propertyData.amenities === "string" ? propertyData.amenities.split(",") : (propertyData.amenities || []),
        highlights: typeof propertyData.highlights === "string" ? propertyData.highlights.split(",") : (propertyData.highlights || []),
        isPetsAllowed: propertyData.isPetsAllowed === "true" || propertyData.isPetsAllowed === true,
        isParkingIncluded: propertyData.isParkingIncluded === "true" || propertyData.isParkingIncluded === true,
        pricePerMonth: parseFloat(propertyData.pricePerMonth),
        securityDeposit: parseFloat(propertyData.securityDeposit),
        applicationFee: parseFloat(propertyData.applicationFee),
        beds: parseInt(propertyData.beds),
        baths: parseFloat(propertyData.baths),
        squareFeet: parseInt(propertyData.squareFeet),
      },
      include: { location: true, manager: true },
    });

    res.status(201).json(newProperty);
  } catch (err: any) {
    res.status(500).json({ message: `Error creating property: ${err.message}` });
  }
};