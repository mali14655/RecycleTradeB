const SellRequest = require('../controllers/sellRequestController');
const { validationResult } = require('express-validator');

// user creates sell request (C2B)
exports.createSellRequest = async (req,res,next)=>{
  try{
    const { productTitle, description, expectedPrice, images } = req.body;
    const request = new SellRequest({
      productTitle,
      description,
      expectedPrice,
      images: images || [],
      seller: req.user._id
    });
    await request.save();
    res.json(request);
  }catch(err){ next(err); }
};

// get all sell requests (admin view)
exports.getSellRequests = async (req,res,next)=>{
  try{
    const requests = await SellRequest.find().populate('seller','name email');
    res.json(requests);
  }catch(err){ next(err); }
};

// admin approves/rejects
exports.updateSellRequestStatus = async (req,res,next)=>{
  try{
    const { status, companyResponse } = req.body;
    const request = await SellRequest.findById(req.params.id);
    if(!request) return res.status(404).json({ message: 'Request not found' });
    if(!['approved','rejected','completed'].includes(status)) return res.status(400).json({ message: 'Invalid status' });

    request.status = status;
    if(companyResponse) request.companyResponse = companyResponse;
    request.updatedAt = Date.now();
    await request.save();
    res.json(request);
  }catch(err){ next(err); }
};

// seller checks own requests
exports.getMySellRequests = async (req,res,next)=>{
  try{
    const requests = await SellRequest.find({ seller: req.user._id });
    res.json(requests);
  }catch(err){ next(err); }
};
