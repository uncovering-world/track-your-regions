// api/regions.js

const express = require('express');
const router = express.Router();
const { Region, Experience } = require('../models');

// GET /regions/{regionId}/experiences
router.get('/regions/:regionId/experiences', async (req, res) => {
  try {
    const regionId = parseInt(req.params.regionId);
    // Retrieve experiences for the region
    const experiences = await Experience.findAll({ where: { regionId } });
    res.status(200).json(experiences);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /user/regions
router.get('/user/regions', async (req, res) => {
  try {
    // Retrieve regions for the authenticated user
    const regions = await Region.findAll({ where: { userId: req.user.id } });
    res.status(200).json(regions);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /user/regions/{regionId}
router.get('/user/regions/:regionId', async (req, res) => {
  try {
    const regionId = parseInt(req.params.regionId);
    // Retrieve a specific region for the authenticated user
    const region = await Region.findOne({ where: { id: regionId, userId: req.user.id } });
    if (region) {
      res.status(200).json(region);
    } else {
      res.status(404).json({ error: 'Region not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /user/experiences
router.get('/user/experiences', async (req, res) => {
  try {
    // Retrieve experiences for the authenticated user
    const experiences = await Experience.findAll({ where: { userId: req.user.id } });
    res.status(200).json(experiences);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /user/experiences/{experienceId}
router.get('/user/experiences/:experienceId', async (req, res) => {
  try {
    const experienceId = parseInt(req.params.experienceId);
    // Retrieve a specific experience for the authenticated user
    const experience = await Experience.findOne({ where: { id: experienceId, userId: req.user.id } });
    if (experience) {
      res.status(200).json(experience);
    } else {
      res.status(404).json({ error: 'Experience not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /user/{userId}/regions
router.get('/user/:userId/regions', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    // Retrieve regions for a specific user
    const regions = await Region.findAll({ where: { userId } });
    if (regions.length > 0) {
      res.status(200).json(regions);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /user/{userId}/experiences
router.get('/user/:userId/experiences', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    // Retrieve experiences for a specific user
    const experiences = await Experience.findAll({ where: { userId } });
    if (experiences.length > 0) {
      res.status(200).json(experiences);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
