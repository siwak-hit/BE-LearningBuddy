const express = require('express');
const studentNoteController = require('../controllers/studentNote.controller');

const router = express.Router();

router.get('/', studentNoteController.list);
router.post('/', studentNoteController.create);
router.put('/:id', studentNoteController.update);
router.delete('/:id', studentNoteController.remove);

module.exports = router;
