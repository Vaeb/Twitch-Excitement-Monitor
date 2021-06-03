import mongoose from 'mongoose';

const { connect } = mongoose;

await connect('mongodb://localhost:27017/hype', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

export * from './ActivityMixed';
