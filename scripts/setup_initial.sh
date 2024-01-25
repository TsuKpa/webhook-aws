#!/bin/sh
# sh scripts/setup_initial.sh config/app-config-demo.json
# Configuration File Path
APP_CONFIG=$1
export APP_CONFIG=$1

echo ==--------CheckDedendencies---------==
aws --version
npm --version
jq --version

ACCOUNT=$(cat $APP_CONFIG | jq -r '.project.account') #ex> 123456789123
REGION=$(cat $APP_CONFIG | jq -r '.project.region') #ex> ap-southeast-1
PROFILE_NAME=$(cat $APP_CONFIG | jq -r '.project.profile') #ex> demo

echo ==--------ConfigInfo---------==
echo $APP_CONFIG
echo $ACCOUNT
echo $REGION
echo $PROFILE_NAME
echo .
echo .

echo ==--------SetAwsProfileEnv---------==
if [ -z "$PROFILE_NAME" ]; then
    echo "project.profile is empty, default AWS Profile is used"
else
    if [ -z "$ON_PIPELINE" ]; then
        echo "$PROFILE_NAME AWS Profile is used"
        export AWS_PROFILE=$PROFILE_NAME
    else
        echo "Now on CodePipeline, default AWS Profile is used"
    fi
fi
echo .
echo .

echo ==--------InstallCDKDependencies---------==
npm install
echo .
echo .

echo ==--------CDKVersionCheck---------==
alias cdk-local="./node_modules/.bin/cdk"
npm install -g aws-cdk
cdk --version
cdk-local --version
echo .
echo .

echo ==--------BootstrapCDKEnvironment---------==
cdk-local bootstrap aws://$ACCOUNT/$REGION
echo .
echo .

