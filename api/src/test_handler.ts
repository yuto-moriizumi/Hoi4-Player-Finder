import express from 'express';

export default (req: express.Request, res: express.Response) => {
  if (req.query && req.query.id) {
    res.status(200).send(`Hi! ${req.query.id}`);
    return;
  }
  res.status(400).send('Who are you?');
};
