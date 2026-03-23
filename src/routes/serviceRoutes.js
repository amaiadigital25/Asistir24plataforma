const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');
const auth = require('../middlewares/authMiddleware');

router.post('/', auth, serviceController.createService);
router.get('/', auth, serviceController.getServices);

module.exports = router;
