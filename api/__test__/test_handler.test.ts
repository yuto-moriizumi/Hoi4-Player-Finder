import express from 'express';
import test_handler from '../src/test_handler';

test('status 200 with id', () => {
  const req = {
    query: {
      id: 'ezaki',
    },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  test_handler(
    (req as unknown) as express.Request,
    (res as unknown) as express.Response
  );
  expect(res.status.mock.calls[0][0]).toBe(200);
});

test('status 400 without id', () => {
  const req = {};
  const res = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  test_handler(
    (req as unknown) as express.Request,
    (res as unknown) as express.Response
  );
  expect(res.status.mock.calls[0][0]).toBe(400);
});
