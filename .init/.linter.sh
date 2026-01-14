#!/bin/bash
cd /home/kavia/workspace/code-generation/simple-calculator-interface-42132-42124/frontend_calculator
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

