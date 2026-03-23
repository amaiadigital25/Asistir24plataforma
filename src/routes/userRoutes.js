const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const auth = require('../middlewares/authMiddleware');

router.post('/', auth, userController.createUser);
router.get('/', auth, userController.getUsers);
router.delete('/:id', auth, userController.deleteUser);

module.exports = router;
