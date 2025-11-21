const router = require('express').Router();
const { authMiddleware, roleCheck } = require('../middlewares/auth');
const sellController = require('../controllers/sellRequestController');

// C2B flow
router.post('/', authMiddleware, roleCheck(['buyer','seller_candidate']), sellController.createSellRequest);
router.get('/my', authMiddleware, sellController.getMySellRequests);
router.get('/', authMiddleware, roleCheck(['admin','company']), sellController.getSellRequests);
router.put('/:id', authMiddleware, roleCheck(['admin','company']), sellController.updateSellRequestStatus);

module.exports = router;
